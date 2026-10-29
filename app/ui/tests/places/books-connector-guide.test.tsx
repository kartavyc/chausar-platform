// Current Zoho owner guide is localized while preserving live missing-setting and checked-date evidence.
import {expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {TextProvider} from '../../src/text';
import {Guide} from '../../src/places/connections/Guide';
it('Zoho owner guide is Hindi without hiding a live missing setting',()=>{render(<TextProvider language="hi"><Guide connectorId="zoho-books" guide={{steps:['Original engine step'],skipped:'Original skip',checks:'Original check',sends:'Original sends',agentLimits:'Original limits',charges:{line:'Original charge',checkedOn:null},missing:'Current owner reconnect required'}}/></TextProvider>);expect(screen.getByText(/क्लाइंट की संस्था और वित्त वर्ष चुनें/)).toBeTruthy();expect(screen.getByText('Current owner reconnect required')).toBeTruthy();expect(screen.queryByText('Original sends')).toBeNull();expect(screen.getByText(/अपने आप दोबारा कोशिश नहीं/)).toBeTruthy();});
