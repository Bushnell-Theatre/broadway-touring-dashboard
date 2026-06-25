(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  root.BTD.config = Object.assign({
    appName: 'Broadway Touring Intelligence Dashboard',
    defaultSeason: '2025-2026',
    dataUrls: [
      'data/data.json',
      'https://white-pebble-01710020f.7.azurestaticapps.net/data/data.json'
    ],
    contextUrls: [
      'data/context.json',
      'https://white-pebble-01710020f.7.azurestaticapps.net/data/context.json'
    ],
    seasonsUrl: 'data/seasons.json',
    peersUrl: 'data/peers.json',
    showsUrl: 'data/shows.json',
    validationUrl: 'data/validation_report.json'
  }, root.BTD.config || {});
})(window);
