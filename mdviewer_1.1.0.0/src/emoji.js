// Small, dependency-free emoji shortcode table covering the common cases
// people actually type. Not the full GitHub set (~1800 codes) — that would
// need an extra data file; this covers everyday usage with zero weight.
window.EMOJI_MAP = {
  smile: '😄', smiley: '😃', grin: '😁', laughing: '😆', joy: '😂',
  rofl: '🤣', wink: '😉', blush: '😊', heart_eyes: '😍', kissing_heart: '😘',
  thinking: '🤔', neutral_face: '😐', expressionless: '😑', confused: '😕',
  worried: '😟', cry: '😢', sob: '😭', angry: '😠', rage: '😡',
  scream: '😱', sweat: '😓', tired_face: '😫', sleepy: '😪', sleeping: '😴',
  triumph: '😤', smirk: '😏', unamused: '😒', flushed: '😳', dizzy_face: '😵',
  astonished: '😲', open_mouth: '😮', hushed: '😯', heart: '❤️', broken_heart: '💔',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', clap: '👏',
  pray: '🙏', wave: '👋', muscle: '💪', point_right: '👉', point_left: '👈',
  ok_hand: '👌', raised_hands: '🙌', fire: '🔥', star: '⭐', sparkles: '✨',
  tada: '🎉', confetti_ball: '🎊', rocket: '🚀', boom: '💥', zap: '⚡',
  warning: '⚠️', white_check_mark: '✅', x: '❌', heavy_check_mark: '✔️',
  question: '❓', exclamation: '❗', bulb: '💡', lock: '🔒', unlock: '🔓',
  key: '🔑', mag: '🔍', bell: '🔔', no_bell: '🔕', eyes: '👀',
  hourglass: '⏳', stopwatch: '⏱️', calendar: '📅', memo: '📝', pencil2: '✏️',
  bookmark: '🔖', book: '📖', books: '📚', package: '📦', gift: '🎁',
  email: '📧', envelope: '✉️', phone: '📞', computer: '💻', desktop_computer: '🖥️',
  printer: '🖨️', floppy_disk: '💾', cd: '💿', dvd: '📀', camera: '📷',
  movie_camera: '🎥', tv: '📺', radio: '📻', microphone: '🎤', headphones: '🎧',
  art: '🎨', musical_note: '🎵', musical_notes: '🎶', game_die: '🎲', chess_pawn: '♟️',
  trophy: '🏆', medal_sports: '🏅', soccer: '⚽', basketball: '🏀', football: '🏈',
  coffee: '☕', tea: '🍵', beer: '🍺', pizza: '🍕', hamburger: '🍔',
  apple: '🍎', earth_americas: '🌎', sunny: '☀️', cloud: '☁️', rainbow: '🌈',
  moon: '🌙', star2: '🌟', snowflake: '❄️', dog: '🐶', cat: '🐱',
  rabbit: '🐰', bear: '🐻', panda_face: '🐼', tiger: '🐯', unicorn: '🦄',
  recycle: '♻️', white_flower: '💮', octocat: '🐙', construction: '🚧',
  bug: '🐛', ant: '🐜', spider: '🕷️', checkered_flag: '🏁', triangular_flag_on_post: '🚩'
};

window.replaceEmojiShortcodes = function (text) {
  return text.replace(/:([a-z0-9_+-]+):/gi, (match, code) => {
    const emoji = window.EMOJI_MAP[code.toLowerCase()];
    return emoji || match;
  });
};
