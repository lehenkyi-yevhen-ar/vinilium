import { z } from "zod";

/**
 * Zod 4 builds faster parsers with `new Function(...)` when the environment allows it, and PROBES for that with `Function("")` on first
 * use. In a browser under a Content-Security-Policy without 'unsafe-eval' the probe throws (caught, so nothing breaks) but the browser
 * still files a violation report every time. We do not need the speed in the browser, so the client forms import this first: with
 * `jitless` set, Zod never probes. Server code keeps the faster path.
 */
z.config({ jitless: true });
