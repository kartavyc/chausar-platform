import {it,expect} from 'vitest';
import {EngineError} from '../../src/engine/types';
import {refusalWords} from '../../src/parts/custody';
import {CATALOGUES,format} from '../../src/text';
it('social delivery refusals have localised owner actions in both languages',()=>{for(const language of ['en','hi'] as const)for(const code of ['SOCIAL_VOICE_CHANGED','SOCIAL_REPORT_MONTH_REQUIRED','SOCIAL_EXPORTS_REQUIRED']){const words=refusalWords(new EngineError(code,'untranslated engine fallback'),(key,values)=>format(CATALOGUES[language],language,key,values));expect(words).not.toContain('fallback');expect(words).not.toContain('pb-social.');if(language==='hi')expect(words).toMatch(/[\u0900-\u097f]/);}});
