import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { CONFIG, STORE, readConfig } from './app/config';
import { FleetMember } from './app/model';
import { createStore } from './app/store';
import { installPerf } from './app/perf';

async function main(): Promise<void> {
  const config = readConfig(location.search);
  if (config.perf) installPerf();
  const res = await fetch(`/fleet?seed=${config.seed}&n=${config.n}`);
  if (!res.ok) throw new Error(`Could not load the fleet: ${res.status} ${await res.text()}`);
  const fleet: FleetMember[] = await res.json();
  const store = createStore(config.mode, fleet);
  await bootstrapApplication(App, {
    providers: [...appConfig.providers, { provide: CONFIG, useValue: config }, { provide: STORE, useValue: store }],
  });
}

main().catch((err) => {
  console.error(err);
  const p = document.createElement('p');
  p.setAttribute('role', 'alert');
  p.style.padding = '16px';
  p.textContent = String(err?.message ?? err);
  document.body.prepend(p);
});
