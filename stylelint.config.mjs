export default {
  ignoreFiles: ["node_modules/**", "verification/**"],
  rules: {
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-properties": true,
    "property-no-unknown": true,
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["has"] }],
    "selector-pseudo-element-no-unknown": true
  }
};
