// Quick reactions people can leave on conversation messages, in palette order.
// The palette draws them with the bundled font in src/assets/fonts, so every system shows them alike.
export const REACTIONS = Object.freeze(['❤️', '👍', '😆', '😮', '👏', '🎊', '🤗', '🫪']);

export const isReaction = value => REACTIONS.includes(value);
