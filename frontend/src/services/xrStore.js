import { createXRStore } from '@react-three/xr'

// One shared XR store for the app. The built-in emulator is turned off so the
// desktop browser behaves normally; a real headset (Meta Quest) is used for VR.
export const xrStore = createXRStore({ emulate: false })
