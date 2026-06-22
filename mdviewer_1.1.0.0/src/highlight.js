// Minimal, dependency-free syntax highlighter.
// Not as exhaustive as highlight.js, but covers the common cases people
// paste into markdown code blocks, with zero added dependencies/weight.
(function () {
  const RULES = {
    keyword: /\b(function|const|let|var|return|if|else|for|while|do|switch|case|break|continue|class|extends|new|this|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|void|yield|static|public|private|protected|interface|implements|enum|namespace|def|elif|pass|lambda|with|as|None|True|False|self|fn|impl|pub|use|mod|struct|trait|match|loop|let mut|package|func|go|defer|chan|range|select)\b/g,
    string: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    comment: /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm,
    number: /\b(0x[0-9a-fA-F]+|\d+\.?\d*)\b/g,
    function: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/g,
    tag: /(&lt;\/?[a-zA-Z][\w-]*|\/?&gt;)/g,
    attr: /\b([a-zA-Z-]+)(?==)/g
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Tokenize by walking the string and matching the highest-priority rule
  // that starts earliest, to avoid nested/overlapping span corruption.
  function highlight(code, lang) {
    const escaped = escapeHtml(code);
    const isMarkup = /^(html|xml|svg)$/i.test(lang || '');

    // Collect all matches for relevant rule types, then merge non-overlapping.
    const activeRules = isMarkup
      ? { tag: RULES.tag, attr: RULES.attr, string: RULES.string, comment: /(<!--[\s\S]*?-->)/g }
      : { comment: RULES.comment, string: RULES.string, keyword: RULES.keyword, number: RULES.number, function: RULES.function };

    const matches = [];
    for (const [type, re] of Object.entries(activeRules)) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(escaped)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] });
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    // Priority order: comment > string > keyword/tag/attr > number > function
    const priority = { comment: 0, string: 1, tag: 2, attr: 2, keyword: 2, number: 3, function: 4 };
    matches.sort((a, b) => a.start - b.start || priority[a.type] - priority[b.type]);

    const out = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start < cursor) continue; // overlapping with a higher-priority match already placed
      if (m.start > cursor) out.push(escaped.slice(cursor, m.start));
      out.push(`<span class="tok-${m.type}">${m.text}</span>`);
      cursor = m.end;
    }
    if (cursor < escaped.length) out.push(escaped.slice(cursor));
    return out.join('');
  }

  window.miniHighlight = highlight;
})();
