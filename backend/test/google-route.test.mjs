import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleRoutePlanner } from '../src/infrastructure/google-route.js';
test('Google driving routes validate geometry and limit repeated requests', async () => {
  let request;
  const plan = createGoogleRoutePlanner('test-key', async (url, options) => {
    request = {url,options};
    return {ok:true,json:async()=>({routes:[{distanceMeters:3247,duration:'566s',polyline:{geoJsonLinestring:{coordinates:[[123.88,10.31],[123.89,10.30]]}}}]})};
  });
  const result=await plan({latitude:10.31,longitude:123.88},{latitude:10.30,longitude:123.89},1);
  assert.equal(result.durationSeconds,566);
  assert.equal(result.distanceMeters,3247);
  assert.equal(result.coordinates.length,2);
  assert.equal(request.url,'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(JSON.parse(request.options.body).routingPreference,'TRAFFIC_UNAWARE');
  await assert.rejects(plan({}, {}, 1), /limit/);
});
test('missing configuration and malformed routes fail closed', async () => {
  await assert.rejects(createGoogleRoutePlanner('')({}, {}, 1), /not configured/);
  for(const body of [{routes:[]},{routes:[{distanceMeters:1,duration:'1s',polyline:{geoJsonLinestring:{coordinates:[[999,1],[1,1]]}}}]}]){
    await assert.rejects(createGoogleRoutePlanner('test',async()=>({ok:true,json:async()=>body}))({}, {}, 1), /valid road route/);
  }
});
