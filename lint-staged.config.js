const quote = (files) => files.map((file) => `"${file}"`).join(' ');

// Each app lints with its own ESLint install and config.
export default {
  'client/**/*.{ts,tsx,js,jsx}': (files) => `npm run lint:fix --prefix client -- ${quote(files)}`,
  'server/**/*.{ts,js}': (files) => `npm run lint:fix --prefix server -- ${quote(files)}`,
};
