/**
 * The write-back place module: Work's `write` sub-place (write connections, WK-06) and `caps`
 * sub-place (limits, WK-12). A connection's sheet is the address's `sheet`, its engine id.
 */
import type { PlaceModule, PlaceRenderProps } from '../../places/types.ts';
import { WB_SUBS, isAdmin, useWbHost, wbWords, type WbProps, type WbSub } from './shared.tsx';
import { WritePage } from './WriteConnections.tsx';
import { CapsPage } from './Caps.tsx';

const isSub = (value: string | undefined): value is WbSub => value !== undefined && (WB_SUBS as readonly string[]).includes(value);

function WritebackPlace(props: PlaceRenderProps & { sub: WbSub }) {
  const host = useWbHost(props, props.sub);
  const p: WbProps = { ...props, w: wbWords(props.language), host, sub: props.sub, admin: isAdmin(props) };
  return props.sub === 'write' ? <WritePage p={p} /> : <CapsPage p={p} />;
}

/** The write-back module: draws work/write and work/caps only. */
export const writebackPlace: PlaceModule = {
  id: 'writeback',
  handles: address => address.place === 'work' && isSub(address.sub),
  render: props => {
    const sub = props.address.sub;
    return isSub(sub) ? <WritebackPlace key={sub} {...props} sub={sub} /> : null;
  },
};
