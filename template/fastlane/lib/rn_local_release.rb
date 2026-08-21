# frozen_string_literal: true

# Loaded via Fastlane `import` so DSL methods (sh, gradle, UI) resolve.

require "json"
require "digest"
require "fileutils"
require "pathname"
require "time"

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

def require_env!(name)
  value = ENV[name].to_s.strip
  UI.user_error!("Missing required environment variable: #{name}. See fastlane/.env.example.") if value.empty?
  value
end

def resolve_path(path)
  return nil if path.nil? || path.strip.empty?
  expanded = File.expand_path(path.strip, repo_root)
  UI.user_error!("File not found: #{expanded}") unless File.exist?(expanded)
  expanded
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
    Actions.sh("git status --porcelain", log: false).to_s.strip
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

  UI.user_error!("Missing #{name}. Set it in fastlane/.env or android/keystore.properties.")
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

def current_marketing_version
  File.read(package_json_path)[/\"version\"\s*:\s*\"([^\"]+)\"/, 1] ||
    UI.user_error!("Could not read version from package.json")
end

def current_android_build
  File.read(android_build_gradle_path)[/versionCode\s+(\d+)/, 1] ||
    UI.user_error!("Could not read versionCode from Android build.gradle")
end

def current_ios_build
  File.read(ios_pbxproj_path)[/CURRENT_PROJECT_VERSION = (\d+);/, 1] || "1"
end

def next_semver(version, bump)
  parts = version.to_s.split(".")
  UI.user_error!("Invalid marketing version: #{version}") if parts.empty?
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

def ios_build_for(marketing_version, android_build)
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
  if pattern && !pattern.empty?
    needle = pattern.sub("VERSION", version)
    # Replace existing return 'x' / return "x"
    unless text.sub!(/return\s+'[^']+'/, "return '#{version}'") ||
           text.sub!(/return\s+"[^"]+"/, "return \"#{version}\"")
      UI.user_error!("Could not update string literal version in #{path}")
    end
  else
    unless text.sub!(/return\s+'[^']+'/, "return '#{version}'") ||
           text.sub!(/return\s+"[^"]+"/, "return \"#{version}\"")
      UI.user_error!("Could not update string literal version in #{path}")
    end
  end
  File.write(path, text)
end

def write_aligned_versions!(marketing_version, android_build)
  marketing_version = marketing_version.to_s.strip
  android_build = android_build.to_i
  UI.user_error!("Invalid marketing version: #{marketing_version}") if marketing_version.empty?
  UI.user_error!("Invalid Android build number: #{android_build}") if android_build < 1

  previous_android = current_android_build.to_i
  UI.user_error!("Refusing to downgrade Android versionCode (#{previous_android} -> #{android_build})") if android_build < previous_android

  ios_build = ios_build_for(marketing_version, android_build)

  (config.dig("version", "sources") || []).each do |source|
    absolute = File.join(repo_root, source["path"])
    case source["kind"]
    when "packageJson"
      package = File.read(absolute)
      package = package.sub(/\"version\"\s*:\s*\"[^\"]+\"/, "\"version\": \"#{marketing_version}\"")
      File.write(absolute, package)
    when "androidGradle"
      gradle = File.read(absolute)
      gradle = gradle.sub(/versionCode\s+\d+/, "versionCode #{android_build}")
      gradle = gradle.sub(/versionName\s+\"[^\"]+\"/, "versionName \"#{marketing_version}\"")
      File.write(absolute, gradle)
    when "iosPbxproj"
      pbx = File.read(absolute)
      pbx = pbx.gsub(/CURRENT_PROJECT_VERSION = \d+;/, "CURRENT_PROJECT_VERSION = #{ios_build};")
      pbx = pbx.gsub(/MARKETING_VERSION = [^;]+;/, "MARKETING_VERSION = #{marketing_version};")
      File.write(absolute, pbx)
    when "stringLiteral"
      replace_string_literal!(absolute, marketing_version, source["pattern"])
    else
      UI.user_error!("Unknown version source kind: #{source['kind']}")
    end
  end

  (config.dig("version", "extraFiles") || []).each do |extra|
    absolute = File.join(repo_root, extra["path"])
    case extra["kind"]
    when "stringLiteral"
      replace_string_literal!(absolute, marketing_version, extra["pattern"])
    else
      UI.user_error!("Unknown extra version kind: #{extra['kind']}")
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

def run_shell_commands!(commands)
  Dir.chdir(repo_root) do
    Array(commands).each { |command| sh(command) }
  end
end

def compile_js!
  command = config.dig("build", "typecheckCommand")
  UI.user_error!("build.typecheckCommand is missing") if command.to_s.strip.empty?
  Dir.chdir(repo_root) { sh(command) }
end

def run_verify!
  install = config.dig("verify", "install")
  commands = config.dig("verify", "commands") || []
  run_shell_commands!([install, *commands].compact.reject(&:empty?))
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
  if File.exist?(ipa)
    lines << "IPA: #{(File.size(ipa) / 1024.0 / 1024.0).round(1)} MB (#{ipa})"
  end
  if File.exist?(aab)
    lines << "AAB: #{(File.size(aab) / 1024.0 / 1024.0).round(1)} MB (#{aab})"
  end
  lines.each { |line| UI.important(line) }
end

def manifest_path
  File.join(repo_root, "build", "release-manifest.json")
end

def write_manifest!
  ipa_size = assert_artifact!(ios_ipa_path, "iOS IPA", config.dig("build", "maxIpaSizeMb"))
  aab_size = assert_artifact!(android_aab_path, "Android AAB", config.dig("build", "maxAabSizeMb"))
  payload = {
    "version" => current_marketing_version,
    "androidBuild" => current_android_build.to_i,
    "iosBuild" => current_ios_build.to_i,
    "packageName" => config.dig("app", "packageName"),
    "createdAt" => Time.now.utc.iso8601,
    "artifacts" => {
      "ipa" => {
        "path" => Pathname.new(ios_ipa_path).relative_path_from(Pathname.new(repo_root)).to_s,
        "sha256" => file_sha256(ios_ipa_path),
        "bytes" => ipa_size
      },
      "aab" => {
        "path" => Pathname.new(android_aab_path).relative_path_from(Pathname.new(repo_root)).to_s,
        "sha256" => file_sha256(android_aab_path),
        "bytes" => aab_size
      }
    }
  }
  FileUtils.mkdir_p(File.dirname(manifest_path))
  File.write(manifest_path, JSON.pretty_generate(payload))
  UI.success("Wrote #{manifest_path}")
  payload
end

def read_manifest!
  UI.user_error!("Missing release manifest at #{manifest_path}. Run compile first.") unless File.exist?(manifest_path)
  JSON.parse(File.read(manifest_path))
end

def assert_manifest_artifacts!
  manifest = read_manifest!
  ipa = File.join(repo_root, manifest.dig("artifacts", "ipa", "path"))
  aab = File.join(repo_root, manifest.dig("artifacts", "aab", "path"))
  UI.user_error!("IPA missing for upload: #{ipa}") unless File.exist?(ipa)
  UI.user_error!("AAB missing for upload: #{aab}") unless File.exist?(aab)
  expected_ipa = manifest.dig("artifacts", "ipa", "sha256")
  expected_aab = manifest.dig("artifacts", "aab", "sha256")
  UI.user_error!("IPA checksum mismatch. Re-run compile before upload.") if file_sha256(ipa) != expected_ipa
  UI.user_error!("AAB checksum mismatch. Re-run compile before upload.") if file_sha256(aab) != expected_aab
  if manifest["version"] != current_marketing_version
    UI.user_error!("Manifest version #{manifest['version']} does not match package.json #{current_marketing_version}")
  end
  manifest
end

def compile_all!
  UI.important("Compiling TypeScript + iOS Release IPA + Android Release AAB (no install, no upload)")
  compile_js!
  build_ios_ipa!
  build_android_aab!
  report_artifact_sizes!
  write_manifest!
  UI.success("Release compile succeeded for iOS and Android.")
end

def upload_ios!(options = {})
  load_asc_api_key
  upload_to_testflight(
    ipa: ios_ipa_path,
    skip_waiting_for_build_processing: true,
    distribute_external: false,
    changelog: options[:changelog]
  )
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
  UI.success("Doctor checks passed (config + project paths).")
end
