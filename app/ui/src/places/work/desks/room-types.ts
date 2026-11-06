import type {RoomBriefBody} from '../../../../../../platform/runtime/venture/playbooks/virtual-assistant/records';
import type { clientRoomView } from '../../../../../../platform/runtime/venture/playbooks/kit/client-room-core.ts';
export type RoomItem=RoomBriefBody&{id:string;client:ReturnType<typeof clientRoomView>};
