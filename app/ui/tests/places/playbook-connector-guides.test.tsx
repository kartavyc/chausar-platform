// Localized owner setup paths preserve live missing-setting and dated-charge evidence.
import {expect,it} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {TextProvider} from '../../src/text';
import {Guide} from '../../src/places/connections/Guide';
import en from '../../src/text/en/pb-connector-guides.json';
import hi from '../../src/text/hi/pb-connector-guides.json';
const original={steps:['Engine step'],skipped:'Engine skip',checks:'Engine checks',sends:'Engine sends',agentLimits:'Engine limits',charges:{line:'Engine charge',checkedOn:'2026-10-29'},missing:'Current connection needs attention'};
it('each new guide renders its complete Hindi setup without hiding current evidence',()=>{
 for(const id of new Set(Object.keys(en).map(key=>key.split('.')[1]!))){cleanup();render(<TextProvider language="hi"><Guide connectorId={id} guide={original}/></TextProvider>);const words=hi as Record<string,string>;expect(screen.getByText('1. '+words[`pb-connector-guides.${id}.step1`])).toBeTruthy();expect(screen.getByText(words[`pb-connector-guides.${id}.sends`]!)).toBeTruthy();expect(screen.getByText('Current connection needs attention')).toBeTruthy();expect(screen.queryByText('Engine sends')).toBeNull();expect(document.querySelector('[data-guide="charges"]')?.textContent).toContain('2026');}
});
it('an unrelated guide keeps current engine wording',()=>{render(<TextProvider language="hi"><Guide connectorId="github" guide={original}/></TextProvider>);expect(screen.getByText('Engine step')).toBeTruthy();expect(screen.getByText('Engine sends')).toBeTruthy();});
