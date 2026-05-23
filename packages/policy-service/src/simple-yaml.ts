export function parsePolicyFile(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Unsupported policy YAML line: ${rawLine}`);
    }
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const key = match[1].trim();
    const rawValue = match[2].trim();
    const target = stack[stack.length - 1].value;
    if (rawValue === '') {
      const child: Record<string, unknown> = {};
      target[key] = child;
      stack.push({ indent, value: child });
    } else {
      target[key] = parseScalar(rawValue);
    }
  }

  return root;
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => String(parseScalar(item.trim().replace(/^['"]|['"]$/g, ''))));
  }
  return value.replace(/^['"]|['"]$/g, '');
}
