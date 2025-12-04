module.exports = {
  extends: [
    "stylelint-config-standard",
    "stylelint-config-tailwindcss"
  ],
  rules: {
    // Allow Tailwind directives and utilities
    "at-rule-no-unknown": null
  }
}
