boh_add_test(site_build tests/unit/site-build.test.ts)

# Browser tests need Chrome (BOH_CHROME), see docs/building.md.
boh_add_test(site tests/e2e/site.test.ts PROJECT e2e)
