# frozen_string_literal: true

# Loaded via Fastlane `import` so DSL methods (sh, gradle, UI) resolve.

require "json"
require "digest"
require "fileutils"
require "pathname"
require "time"
require "open3"
require "shellwords"

def repo_root
  @repo_root ||= File.expand_path("../..", __dir__)
end

def config_path
  File.join(repo_root, "fastlane", "release.config.json")
end

def config
  @config ||= begin
    UI.user_error!("Missing #{config_path}. Run the rn-local-release installer.") unless File.exist?(config_path)
    JSON.parse(File.read(config_path))
  end
end

def log_release_error!(message, error = nil)
  return unless config.dig("logging", "enabled") != false

  dir = File.join(repo_root, config.dig("logging", "directory") || "logs")
  FileUtils.mkdir_p(dir)
  File.chmod(0o700, dir) rescue nil
  stamp = Time.now.utc.strftime("%Y%m%dT%H%M%SZ")
  path = File.join(dir, "fastlane-#{stamp}.log")
  body = "[#{Time.now.utc.iso8601}] ERROR #{message}\n"
  body += "#{error}\n" if error
  body = body.gsub(/password[=:].*/i, "password=[REDACTED]")
             .gsub(/BEGIN [A-Z ]*PRIVATE KEY[\s\S]*?END [A-Z ]*PRIVATE KEY/, "[REDACTED KEY]")
  File.write(path, body)
  File.chmod(0o600, path) rescue nil
  UI.important("Error details written to #{path}")
end

def require_env!(name)
  value = ENV[name].to_s.strip
  UI.user_error!("Missing required environment variable: #{name}. See fastlane/.env.example.") if value.empty?
  value
end

def resolve_path(path)
  return nil if path.nil? || path.strip.empty?
  root_real = File.realpath(repo_root)
  candidate = File.expand_path(path.strip, repo_root)
  UI.user_error!("File not found: #{candidate}") unless File.exist?(candidate)
  UI.user_error!("Refusing symlink path: #{candidate}") if File.symlink?(candidate)
  real = File.realpath(candidate)
  unless real == root_real || real.start_with?(root_real + File::SEPARATOR) || path.strip.start_with?("/")
    # Absolute external vault paths are allowed only when explicitly absolute and outside repo.
  end
  if path.strip.start_with?("/")
    # External absolute path (Keychain vault). Require owner-only mode.
    mode = File.stat(real).mode & 0o777
    UI.user_error!("Insecure permissions on #{real}") if (mode & 0o077) != 0
    return real
  end
  relative = Pathname.new(real).relative_path_from(Pathname.new(root_real)).to_s
  UI.user_error!("Path escapes project root: #{path}") if relative.start_with?("..")
  real
end

def skip_flag?(options, key)
  value = options[key]
  value == true || value.to_s.strip.downcase == "true"
end

def require_option!(options, key)
  value = options[key].to_s.strip
  UI.user_error!("Missing required option: #{key}") if value.empty?
  value
end

def ensure_clean_git!
  return unless config.dig("gates", "requireCleanGitForPromote") != false

  dirty = Dir.chdir(repo_root) do
    stdout, status = Open3.capture2("git", "status", "--porcelain")
    UI.user_error!("git status failed") unless status.success?
    stdout.to_s.strip
  end
  UI.user_error!("Git working tree is dirty. Commit or stash changes before production promotion.") unless dirty.empty?
end

def load_asc_api_key
  app_store_connect_api_key(
    key_id: require_env!("ASC_KEY_ID"),
    issuer_id: require_env!("ASC_ISSUER_ID"),
    key_filepath: resolve_path(require_env!("ASC_KEY_FILEPATH")),
    duration: 1200,
    in_house: false
  )
end

def play_json_key_path
  resolve_path(require_env!("PLAY_JSON_KEY_PATH"))
end

def load_keystore_properties
  path = File.join(repo_root, "android", "keystore.properties")
  return {} unless File.exist?(path)

  mode = File.stat(path).mode & 0o777
  UI.user_error!("Insecure permissions on #{path} (#{mode.to_s(8)}). Run: chmod 600 #{path}") if (mode & 0o077) != 0

  props = {}
  File.foreach(path) do |line|
    next if line.strip.empty? || line.strip.start_with?("#")
    key, value = line.split("=", 2)
    next if key.nil? || value.nil?
    props[key.strip] = value.strip
  end
  props
end

def signing_value(name, default: nil)
  from_env = ENV[name].to_s.strip
  return from_env unless from_env.empty?

  from_file = load_keystore_properties[name].to_s.strip
  return from_file unless from_file.empty?

  return default unless default.nil?

  UI.user_error!("Missing #{name}. Set it in fastlane/.env, Keychain, or android/keystore.properties.")
end

def apply_android_signing_env!
  {
    "MYAPP_UPLOAD_STORE_FILE" => signing_value("MYAPP_UPLOAD_STORE_FILE", default: "keystore.jks"),
    "MYAPP_UPLOAD_STORE_PASSWORD" => signing_value("MYAPP_UPLOAD_STORE_PASSWORD"),
    "MYAPP_UPLOAD_KEY_ALIAS" => signing_value("MYAPP_UPLOAD_KEY_ALIAS", default: "key0"),
    "MYAPP_UPLOAD_KEY_PASSWORD" => signing_value("MYAPP_UPLOAD_KEY_PASSWORD")
  }.each { |key, value| ENV[key] = value }
end

def package_json_path
  File.join(repo_root, "package.json")
end

def android_build_gradle_path
  File.join(repo_root, config.dig("android", "buildGradlePath"))
end

def ios_pbxproj_path
  project = config.dig("ios", "project")
  File.join(repo_root, project, "project.pbxproj")
end

def assert_semver!(version)
  UI.user_error!("Invalid marketing version (SemVer required): #{version}") unless version.to_s.match?(/\A\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?\z/)
end

def current_marketing_version
  File.read(package_json_path)[/\"version\"\s*:\s*\"([^\"]+)\"/, 1] ||
    UI.user_error!("Could not read version from package.json")
end

def current_android_build
  text = File.read(android_build_gradle_path)
  text[/versionCode\s*=\s*(\d+)/, 1] ||
    text[/versionCode\s+(\d+)/, 1] ||
    UI.user_error!("Could not read versionCode from Android build.gradle")
end

def current_ios_build
  File.read(ios_pbxproj_path)[/CURRENT_PROJECT_VERSION = (\d+);/, 1] || "1"
end

def next_semver(version, bump)
  assert_semver!(version)
  parts = version.to_s.split(".")
  parts << "0" while parts.length < 3
  major, minor, patch = parts[0].to_i, parts[1].to_i, parts[2].to_i
  case bump
  when "major"
    "#{major + 1}.0.0"
  when "minor"
    "#{major}.#{minor + 1}.0"
  else
    "#{major}.#{minor}.#{patch + 1}"
  end
end

def ios_build_for(_marketing_version, android_build)
  strategy = config.dig("ios", "buildNumberStrategy") || { "mode" => "increment" }
  mode = strategy["mode"].to_s
  if mode == "fixed"
    value = strategy["value"].to_i
    UI.user_error!("ios.buildNumberStrategy.value must be >= 1") if value < 1
    value
  else
    android_build.to_i
  end
end

def replace_string_literal!(path, version, pattern = nil)
  text = File.read(path)
  replaced = false
  if pattern && !pattern.empty?
    expected = pattern.sub("VERSION", version)
    if text.include?(expected)
      replaced = true
    elsif text.sub!(/return\s+'[^']+'/, "return '#{version}'") ||
          text.sub!(/return\s+"[^"]+"/, "return \"#{version}\"")
      replaced = true
    end
  else
    replaced = text.sub!(/return\s+'[^']+'/, "return '#{version}'") ||
               text.sub!(/return\s+"[^"]+"/, "return \"#{version}\"")
  end
  UI.user_error!("Could not update string literal version in #{path}") unless replaced
  File.write(path, text)
end

def with_version_transaction(files)
  backups = {}
  files.each do |path|
    next unless File.exist?(path)
    backups[path] = File.read(path)
  end
  begin
    yield
  rescue StandardError => e
    backups.each { |path, contents| File.write(path, contents) }
    log_release_error!("Version write failed; restored previous files", e)
    raise
  end
end

def write_aligned_versions!(marketing_version, android_build)
  marketing_version = marketing_version.to_s.strip
  android_build = android_build.to_i
  assert_semver!(marketing_version)
  UI.user_error!("Invalid Android build number: #{android_build}") if android_build < 1

  previous_android = current_android_build.to_i
  UI.user_error!("Refusing to downgrade Android versionCode (#{previous_android} -> #{android_build})") if android_build < previous_android

  ios_build = ios_build_for(marketing_version, android_build)
  sources = config.dig("version", "sources") || []
  extras = config.dig("version", "extraFiles") || []
  touched = (sources + extras).map { |s| File.join(repo_root, s["path"]) }

  with_version_transaction(touched) do
    sources.each do |source|
      absolute = File.join(repo_root, source["path"])
      case source["kind"]
      when "packageJson"
        package = File.read(absolute)
        updated = package.sub(/\"version\"\s*:\s*\"[^\"]+\"/, "\"version\": \"#{marketing_version}\"")
        UI.user_error!("Failed to update package.json version") if updated == package
        File.write(absolute, updated)
      when "androidGradle", "androidGradleKts"
        gradle = File.read(absolute)
        original = gradle.dup
        if source["kind"] == "androidGradleKts" || absolute.end_with?(".kts")
          gradle = gradle.sub(/versionCode\s*=\s*\d+/, "versionCode = #{android_build}")
          gradle = gradle.sub(/versionName\s*=\s*\"[^\"]+\"/, "versionName = \"#{marketing_version}\"")
          # Also support space form
          gradle = gradle.sub(/versionCode\s+\d+/, "versionCode #{android_build}") if gradle == original || !gradle.include?("versionCode = #{android_build}")
          gradle = gradle.sub(/versionName\s+\"[^\"]+\"/, "versionName \"#{marketing_version}\"") unless gradle.include?("versionName = \"#{marketing_version}\"") || gradle.include?("versionName \"#{marketing_version}\"")
        else
          gradle = gradle.sub(/versionCode\s+\d+/, "versionCode #{android_build}")
          gradle = gradle.sub(/versionName\s+\"[^\"]+\"/, "versionName \"#{marketing_version}\"")
        end
        UI.user_error!("Failed to update Android version fields in #{absolute}") if gradle == original
        File.write(absolute, gradle)
      when "iosPbxproj"
        pbx = File.read(absolute)
        original = pbx.dup
        targets = Array(source["targets"]).map(&:to_s).reject(&:empty?)
        if targets.empty?
          pbx = pbx.gsub(/CURRENT_PROJECT_VERSION = \d+;/, "CURRENT_PROJECT_VERSION = #{ios_build};")
          pbx = pbx.gsub(/MARKETING_VERSION = [^;]+;/, "MARKETING_VERSION = #{marketing_version};")
        else
          # Scope replacements to build settings blocks that mention the selected scheme/target name when possible.
          targets.each do |target|
            pbx = pbx.gsub(/(PRODUCT_NAME = #{Regexp.escape(target)};[\s\S]*?)CURRENT_PROJECT_VERSION = \d+;/) do
              "#{Regexp.last_match(1)}CURRENT_PROJECT_VERSION = #{ios_build};"
            end
            pbx = pbx.gsub(/(PRODUCT_NAME = #{Regexp.escape(target)};[\s\S]*?)MARKETING_VERSION = [^;]+;/) do
              "#{Regexp.last_match(1)}MARKETING_VERSION = #{marketing_version};"
            end
          end
          # Fallback if scoped replace missed
          if pbx == original
            pbx = pbx.gsub(/CURRENT_PROJECT_VERSION = \d+;/, "CURRENT_PROJECT_VERSION = #{ios_build};")
            pbx = pbx.gsub(/MARKETING_VERSION = [^;]+;/, "MARKETING_VERSION = #{marketing_version};")
          end
        end
        UI.user_error!("Failed to update iOS version fields in #{absolute}") if pbx == original
        File.write(absolute, pbx)
      when "stringLiteral"
        replace_string_literal!(absolute, marketing_version, source["pattern"])
      else
        UI.user_error!("Unknown version source kind: #{source['kind']}")
      end
    end

    extras.each do |extra|
      absolute = File.join(repo_root, extra["path"])
      case extra["kind"]
      when "stringLiteral"
        replace_string_literal!(absolute, marketing_version, extra["pattern"])
      else
        UI.user_error!("Unknown extra version kind: #{extra['kind']}")
      end
    end
  end

  UI.success("Aligned app version to #{marketing_version} (Android #{android_build}, iOS #{ios_build})")
  { version: marketing_version, android_build: android_build, ios_build: ios_build }
end

def bump_versions!(options = {})
  marketing = options[:version].to_s.strip
  if marketing.empty?
    bump = options[:bump].to_s.strip
    bump = config.dig("version", "defaultBump") if bump.empty?
    bump = "patch" if bump.to_s.empty?
    marketing = next_semver(current_marketing_version, bump)
  end

  build = options[:build].to_s.strip
  build = if build.empty?
            current_android_build.to_i + 1
          else
            build.to_i
          end

  write_aligned_versions!(marketing, build)
end

def parse_allowlisted_command(command)
  trimmed = command.to_s.strip
  UI.user_error!("Empty verify/build command") if trimmed.empty?
  UI.user_error!("Refusing shell metacharacters in command: #{trimmed}") if trimmed.match?(/[;|&`$()<>]/) || trimmed.include?("\n")
  parts = Shellwords.split(trimmed)
  allowed = %w[yarn npm pnpm bundle node]
  UI.user_error!("Command binary not allowlisted: #{parts[0]}") unless allowed.include?(parts[0])
  parts
end

def run_argv_commands!(commands)
  Dir.chdir(repo_root) do
    Array(commands).each do |command|
      parts = parse_allowlisted_command(command)
      UI.message("$ #{parts.join(' ')}")
      success = system(*parts)
      UI.user_error!("Command failed: #{parts.join(' ')}") unless success
    end
  end
end

def compile_js!
  command = config.dig("build", "typecheckCommand")
  UI.user_error!("build.typecheckCommand is missing") if command.to_s.strip.empty?
  run_argv_commands!([command])
end

def run_verify!
  install = config.dig("verify", "install")
  commands = config.dig("verify", "commands") || []
  run_argv_commands!([install, *commands].compact.reject(&:empty?))
end

def ios_ipa_path
  File.join(
    repo_root,
    config.dig("build", "iosOutputDir"),
    config.dig("ios", "outputIpaName")
  )
end

def android_aab_path
  File.join(repo_root, config.dig("android", "aabPath"))
end

def build_ios_ipa!
  cocoapods(
    podfile: File.join(repo_root, "ios", "Podfile"),
    try_repo_update_on_error: true
  )
  build_app(
    workspace: File.join(repo_root, config.dig("ios", "workspace")),
    scheme: config.dig("ios", "scheme"),
    configuration: "Release",
    clean: true,
    export_method: config.dig("ios", "exportMethod"),
    export_options: File.join(repo_root, config.dig("ios", "exportOptionsPath")),
    output_directory: File.join(repo_root, config.dig("build", "iosOutputDir")),
    output_name: config.dig("ios", "outputIpaName"),
    xcargs: "-allowProvisioningUpdates"
  )
end

def build_android_aab!
  apply_android_signing_env!
  gradle(
    task: "bundle",
    build_type: "Release",
    project_dir: File.join(repo_root, "android")
  )
end

def file_sha256(path)
  Digest::SHA256.file(path).hexdigest
end

def assert_artifact!(path, label, max_mb)
  UI.user_error!("Missing #{label}: #{path}") unless File.exist?(path)
  size = File.size(path)
  UI.user_error!("#{label} is empty: #{path}") if size < 1
  if max_mb && size > (max_mb.to_f * 1024 * 1024)
    UI.user_error!("#{label} exceeds budget #{max_mb} MB (actual #{(size / 1024.0 / 1024.0).round(1)} MB)")
  end
  size
end

def report_artifact_sizes!
  ipa = ios_ipa_path
  aab = android_aab_path
  lines = []
  lines << "IPA: #{(File.size(ipa) / 1024.0 / 1024.0).round(1)} MB (#{ipa})" if File.exist?(ipa)
  lines << "AAB: #{(File.size(aab) / 1024.0 / 1024.0).round(1)} MB (#{aab})" if File.exist?(aab)
  lines.each { |line| UI.important(line) }
end

def git_commit_sha
  stdout, status = Open3.capture2("git", "-C", repo_root, "rev-parse", "HEAD")
  status.success? ? stdout.strip : "unknown"
end

def git_dirty?
  stdout, status = Open3.capture2("git", "-C", repo_root, "status", "--porcelain")
  return false unless status.success?
  !stdout.strip.empty?
end

def manifest_path(platform = nil)
  case platform
  when :ios then File.join(repo_root, "build", "release-manifest-ios.json")
  when :android then File.join(repo_root, "build", "release-manifest-android.json")
  else File.join(repo_root, "build", "release-manifest.json")
  end
end

def upload_journal_path
  File.join(repo_root, "build", "upload-journal.json")
end

def write_platform_manifest!(platform)
  case platform
  when :ios
    size = assert_artifact!(ios_ipa_path, "iOS IPA", config.dig("build", "maxIpaSizeMb"))
    payload = {
      "platform" => "ios",
      "version" => current_marketing_version,
      "iosBuild" => current_ios_build.to_i,
      "bundleIdentifier" => config.dig("app", "bundleIdentifier"),
      "gitCommit" => git_commit_sha,
      "gitDirty" => git_dirty?,
      "createdAt" => Time.now.utc.iso8601,
      "artifacts" => {
        "ipa" => {
          "path" => Pathname.new(ios_ipa_path).relative_path_from(Pathname.new(repo_root)).to_s,
          "sha256" => file_sha256(ios_ipa_path),
          "bytes" => size
        }
      }
    }
  when :android
    size = assert_artifact!(android_aab_path, "Android AAB", config.dig("build", "maxAabSizeMb"))
    payload = {
      "platform" => "android",
      "version" => current_marketing_version,
      "androidBuild" => current_android_build.to_i,
      "packageName" => config.dig("app", "packageName"),
      "gitCommit" => git_commit_sha,
      "gitDirty" => git_dirty?,
      "createdAt" => Time.now.utc.iso8601,
      "artifacts" => {
        "aab" => {
          "path" => Pathname.new(android_aab_path).relative_path_from(Pathname.new(repo_root)).to_s,
          "sha256" => file_sha256(android_aab_path),
          "bytes" => size
        }
      }
    }
  else
    UI.user_error!("Unknown platform #{platform}")
  end
  FileUtils.mkdir_p(File.dirname(manifest_path(platform)))
  File.write(manifest_path(platform), JSON.pretty_generate(payload))
  UI.success("Wrote #{manifest_path(platform)}")
  payload
end

def write_manifest!
  ios = write_platform_manifest!(:ios)
  android = write_platform_manifest!(:android)
  payload = {
    "version" => current_marketing_version,
    "androidBuild" => current_android_build.to_i,
    "iosBuild" => current_ios_build.to_i,
    "packageName" => config.dig("app", "packageName"),
    "bundleIdentifier" => config.dig("app", "bundleIdentifier"),
    "gitCommit" => git_commit_sha,
    "gitDirty" => git_dirty?,
    "createdAt" => Time.now.utc.iso8601,
    "artifacts" => {
      "ipa" => ios.dig("artifacts", "ipa"),
      "aab" => android.dig("artifacts", "aab")
    }
  }
  File.write(manifest_path, JSON.pretty_generate(payload))
  UI.success("Wrote #{manifest_path}")
  payload
end

def read_manifest!(platform = nil)
  path = manifest_path(platform)
  UI.user_error!("Missing release manifest at #{path}. Run compile/build first.") unless File.exist?(path)
  JSON.parse(File.read(path))
end

def assert_manifest_artifacts!(platform = nil)
  if config.dig("gates", "requireCompileBeforeUpload") != false
    UI.user_error!("Missing combined release manifest. Run compile first.") unless File.exist?(manifest_path) || platform
  end

  if platform.nil?
    manifest = read_manifest!
    ipa = File.join(repo_root, manifest.dig("artifacts", "ipa", "path"))
    aab = File.join(repo_root, manifest.dig("artifacts", "aab", "path"))
    UI.user_error!("IPA missing for upload: #{ipa}") unless File.exist?(ipa)
    UI.user_error!("AAB missing for upload: #{aab}") unless File.exist?(aab)
    UI.user_error!("IPA checksum mismatch. Re-run compile before upload.") if file_sha256(ipa) != manifest.dig("artifacts", "ipa", "sha256")
    UI.user_error!("AAB checksum mismatch. Re-run compile before upload.") if file_sha256(aab) != manifest.dig("artifacts", "aab", "sha256")
    UI.user_error!("Manifest version mismatch") if manifest["version"] != current_marketing_version
    return manifest
  end

  manifest = read_manifest!(platform)
  if platform == :ios
    ipa = File.join(repo_root, manifest.dig("artifacts", "ipa", "path"))
    UI.user_error!("IPA missing: #{ipa}") unless File.exist?(ipa)
    UI.user_error!("IPA checksum mismatch") if file_sha256(ipa) != manifest.dig("artifacts", "ipa", "sha256")
  else
    aab = File.join(repo_root, manifest.dig("artifacts", "aab", "path"))
    UI.user_error!("AAB missing: #{aab}") unless File.exist?(aab)
    UI.user_error!("AAB checksum mismatch") if file_sha256(aab) != manifest.dig("artifacts", "aab", "sha256")
  end
  UI.user_error!("Manifest version mismatch") if manifest["version"] != current_marketing_version
  manifest
end

def archive_uploaded_version!(platform)
  return unless config.dig("archives", "storeUploadedVersions")

  dir = File.join(repo_root, config.dig("archives", "directory") || "versions")
  version_dir = File.join(dir, current_marketing_version)
  FileUtils.mkdir_p(version_dir)
  if platform == :ios && File.exist?(ios_ipa_path)
    FileUtils.cp(ios_ipa_path, File.join(version_dir, File.basename(ios_ipa_path)))
  end
  if platform == :android && File.exist?(android_aab_path)
    FileUtils.cp(android_aab_path, File.join(version_dir, File.basename(android_aab_path)))
  end
  meta = {
    "version" => current_marketing_version,
    "platform" => platform.to_s,
    "archivedAt" => Time.now.utc.iso8601
  }
  File.write(File.join(version_dir, "#{platform}-meta.json"), JSON.pretty_generate(meta))
  UI.success("Archived #{platform} artifact under #{version_dir}")
end

def write_upload_journal!(state)
  FileUtils.mkdir_p(File.dirname(upload_journal_path))
  File.write(upload_journal_path, JSON.pretty_generate(state.merge("updatedAt" => Time.now.utc.iso8601)))
end

def compile_all!
  UI.important("Compiling TypeScript + iOS Release IPA + Android Release AAB (no install, no upload)")
  compile_js!
  build_ios_ipa!
  build_android_aab!
  report_artifact_sizes!
  write_manifest!
  UI.success("Release compile succeeded for iOS and Android.")
rescue StandardError => e
  log_release_error!("compile_all! failed", e)
  raise
end

def upload_ios!(options = {})
  load_asc_api_key
  upload_to_testflight(
    ipa: ios_ipa_path,
    skip_waiting_for_build_processing: true,
    distribute_external: false,
    changelog: options[:changelog]
  )
  archive_uploaded_version!(:ios)
end

def upload_android!
  upload_to_play_store(
    package_name: config.dig("app", "packageName"),
    track: config.dig("android", "playTrackBeta"),
    json_key: play_json_key_path,
    aab: android_aab_path,
    skip_upload_apk: true,
    skip_upload_metadata: true,
    skip_upload_images: true,
    skip_upload_screenshots: true,
    skip_upload_changelogs: true,
    release_status: config.dig("android", "releaseStatus") || "completed"
  )
  archive_uploaded_version!(:android)
end

def upload_all_resumable!(options = {})
  assert_manifest_artifacts!
  journal = {
    "version" => current_marketing_version,
    "ios" => "pending",
    "android" => "pending"
  }
  write_upload_journal!(journal)
  begin
    upload_ios!(options)
    journal["ios"] = "uploaded"
    write_upload_journal!(journal)
  rescue StandardError => e
    journal["ios"] = "failed"
    write_upload_journal!(journal)
    log_release_error!("iOS upload failed", e)
    raise
  end
  begin
    upload_android!
    journal["android"] = "uploaded"
    write_upload_journal!(journal)
  rescue StandardError => e
    journal["android"] = "failed"
    write_upload_journal!(journal)
    log_release_error!("Android upload failed after iOS success — resume android upload only", e)
    UI.important("Partial upload journal: #{upload_journal_path}")
    raise
  end
  UI.success("Both platforms uploaded.")
end

def confirm_promote!(platform, details)
  UI.important("PRODUCTION PROMOTE CONFIRMATION")
  details.each { |k, v| UI.important("  #{k}: #{v}") }
  unless ENV["CI"] == "true" || ENV["RN_LOCAL_RELEASE_YES"] == "1"
    UI.important("Re-run with RN_LOCAL_RELEASE_YES=1 to confirm non-interactive promote.")
  end
end

def doctor!
  missing = []
  [
    config.dig("ios", "workspace"),
    config.dig("ios", "project"),
    File.join(config.dig("ios", "project"), "project.pbxproj"),
    config.dig("android", "buildGradlePath"),
    config.dig("ios", "exportOptionsPath")
  ].each do |relative|
    missing << relative unless File.exist?(File.join(repo_root, relative))
  end
  UI.user_error!("Doctor failed. Missing paths:\n- #{missing.join("\n- ")}") unless missing.empty?

  UI.message("App: #{config.dig('app', 'displayName')} (#{config.dig('app', 'packageName')})")
  UI.message("Version: #{current_marketing_version} / Android #{current_android_build} / iOS #{current_ios_build}")
  UI.message("iOS strategy: #{config.dig('ios', 'buildNumberStrategy')}")
  UI.message("Credential provider: #{config.dig('credentials', 'provider')}")
  UI.message("Logging: #{config.dig('logging')}")
  UI.message("Archives: #{config.dig('archives')}")
  UI.success("Doctor checks passed (config + project paths).")
end
