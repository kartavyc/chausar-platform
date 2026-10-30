// App-testing owned capabilities. SDK and Docker remain planned until owner setup and named permission review.
import type {CatalogueEntry} from '../catalogue.ts';
export const APP_TESTING_CATALOGUE:readonly CatalogueEntry[]=Object.freeze([
 {id:'android-local',name:'Client Android emulator',category:'build',auth:'Owner-installed SDK and client APK',regions:['india','global'],regionNote:null,note:'Exact client APK operations on a clean emulator only. Owner setup and a named lawyer permission review are required; test manually meanwhile.',vendorUrl:'https://developer.android.com/tools/adb',targets:['write']},
 {id:'docker-local',name:'Private demo desktop',category:'build',auth:'Owner-installed Docker and qualified local image',regions:['india','global'],regionNote:null,note:'Only the supplied throwaway desktop image with fictional client test data. Build and qualify it yourself; prepare scripts meanwhile. No automatic pull or installation.',vendorUrl:'https://docs.docker.com/engine/containers/run/',targets:['write']},
 {id:'app-testing-delivery',name:'Reviewed app report and demo files',category:'docs-ops',auth:'Owner-reviewed current client evidence',regions:['india','global'],regionNote:null,note:'Exports actual source-bound reports or videos after named permission review. The owner delivers them manually.',vendorUrl:null,targets:['handoff']}
]);
