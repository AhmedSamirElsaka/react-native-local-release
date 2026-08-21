export function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}

export function jsonPretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
