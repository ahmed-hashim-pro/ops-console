// The zone.js build (served at /zone/): the same app, with zone.js running
// change detection after every event handler, and the eager store. Only for
// comparison runs; see README "Measurements".
import 'zone.js';
import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { CONFIG, STORE, readConfig } from './app/config';
import { FleetMember } from './app/model';
import { createStore } from './app/store';
import { installPerf } from './app/perf';

async function main(): Promise<void> {
  const config = { ...readConfig(location.search), mode: 'zone' as const };
  if (config.perf) installPerf();
  const res = await fetch(`/fleet?seed=${config.seed}&n=${config.n}`);
  if (!res.ok) throw new Error(`Could not load the fleet: ${res.status} ${await res.text()}`);
  const fleet: FleetMember[] = await res.json();
  await bootstrapApplication(App, {
    providers: [
      provideZoneChangeDetection(),
      ...appConfig.providers,
      { provide: CONFIG, useValue: config },
      { provide: STORE, useValue: createStore('zone', fleet) },
    ],
  });
}

main().catch((err) => {
  console.error(err);
  document.body.prepend(Object.assign(document.createElement('p'), { textContent: String(err?.message ?? err) }));
});
