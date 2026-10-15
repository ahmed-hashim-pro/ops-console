import { TestBed } from '@angular/core/testing';
import { Announcer } from './announcer';
import { Alert } from './model';

function alert(id: number, severity: Alert['severity'], name = `api-eu-west-${id}`): Alert {
  return { id, entityId: id, entityName: name, severity, code: 'cpu-high', raisedAt: 0, resolvedAt: null, acknowledged: false };
}

describe('Announcer', () => {
  it('sums a burst of alerts into one sentence', () => {
    const a = TestBed.inject(Announcer);
    for (let i = 0; i < 50; i++) a.noteAlert(alert(i, i < 3 ? 'critical' : 'warning'));
    expect(a.flush()).toBe('3 new critical alerts, first api-eu-west-0');
    expect(a.flush()).toBe('');
  });

  it('includes warnings only when asked, and says nothing when off', () => {
    const a = TestBed.inject(Announcer);
    a.level.set('all');
    a.noteAlert(alert(1, 'critical', 'db-us-east-0001'));
    a.noteAlert(alert(2, 'warning'));
    expect(a.flush()).toBe('1 new critical alert: db-us-east-0001. 1 new warning');
    a.level.set('off');
    a.noteAlert(alert(3, 'critical'));
    expect(a.flush()).toBe('');
  });

  it('re-announces the same status text', async () => {
    const a = TestBed.inject(Announcer);
    a.say('Updates paused.');
    expect(a.status()).toBe('');
    await Promise.resolve();
    expect(a.status()).toBe('Updates paused.');
  });
});
