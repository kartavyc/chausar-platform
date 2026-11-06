// C2 fake CA desk shares the actual calculators and exact owner approval contracts.
import {fakeCaWorking} from './fake-ca-working';
import {fakeCaPacks} from './fake-ca-packs';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';

export function fakeCaFirmDesk(_host: W4DeskHost): FakePlaybookDesk {
  const work=fakeCaWorking(_host),packs=fakeCaPacks(_host);
  return {
    playbook: 'ca-firm',
    kinds: {working:work.kind,'data-pack':packs.kind},
    receipt:id=>work.receipt(id)??packs.receipt(id),
    forgetPeople(people,removeClient){work.forgetPeople(people,removeClient);packs.forgetPeople(people,removeClient);},
    methods: {
      'venture.ca.differential.add': work.capture,
      'venture.ca.dataPack.export': packs.exportPack,
    },
  };
}
