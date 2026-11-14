# boh — Publishing

boh is a static site: the page and a 404 page. There is nothing else to
publish.

## The site

The `pages` workflow (`.github/workflows/pages.yml`) publishes the site from
`main` to GitHub Pages. It builds it with `scripts/build-site.mjs` under the
repository's Pages path (`/boh/` for a project site), deploys, and then runs
`scripts/smoke-site.mjs` against the deployed address (it retries for a few
minutes while the deploy reaches the edges).

Before the first deploy, set **Settings > Pages > Source** to **GitHub
Actions** in the repository. Pages for a private repository needs a paid
GitHub plan; for a public one it is free.

## Check by hand

Build the site with `npm run build:site` and serve `site/` with any static
file server, or open the deployed address after a deploy.
