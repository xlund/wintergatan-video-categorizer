import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://wintergatan.nsld.eu',
  output: 'static',
  build: {
    assets: 'assets',
  },
});
