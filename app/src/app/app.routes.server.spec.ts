import { RenderMode } from '@angular/ssr';
import { serverRoutes } from './app.routes.server';

describe('serverRoutes', () => {
  it('prerenders only pages that write no canonical, hreflang or share URL', () => {
    // The build prerenders on a local server, so a prerendered page that calls SeoService would
    // publish `http://localhost:<port>/...` as its canonical, og:url, hreflang and JSON-LD url.
    // The login page sets none of them. Anything else should be RenderMode.Server.
    const prerendered = serverRoutes.filter((route) => route.renderMode === RenderMode.Prerender).map((route) => route.path);
    expect(prerendered).toEqual(['login']);
  });
});
