import { localOpenCodeClient, sessionHooks } from './session-plugin.mjs';

export const HerdrStatePlugin = async () => localOpenCodeClient() ? sessionHooks('opencode') : {};

// Native V1 function export and V2 server entrypoint, as in old Herdr.
export default { id: 'herdr.state', server: HerdrStatePlugin, setup() {} };
