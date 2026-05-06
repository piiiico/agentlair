/**
 * /verify-skill — SPA (Skill Provenance Attestation) verifier.
 *
 * Input:
 *   - Paste a SKILL.sig (spa+jwt string)
 *   - Upload skill files (SKILL.md, README.md, etc.)
 *
 * Posts to POST /v1/verify-skill, then displays 4 cards:
 *   1. Input     — sig length + file count
 *   2. Attestation — decoded JWT claims (skill name, publisher, expiry)
 *   3. Signature — server verification result (valid/invalid + kid)
 *   4. Digest    — computed vs claimed, match status
 */

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

const API_BASE = 'https://agentlair.dev';

// ── Baked-in example data ────────────────────────────────────────────────────
// agentlair-email-skill SKILL.sig (test attestation, _test: true)

const EXAMPLE_SKILL_SIG =
  'eyJhbGciOiJFZERTQSIsImtpZCI6ImFsa190ZXN0XzE3NzgwMzg3NjE0NzciLCJ0eXAiOiJzcGErand0In0.eyJpc3MiOiJodHRwczovL2FnZW50bGFpci5kZXYiLCJzdWIiOiJhY2NfdGVzdF9waWNvIiwiYXVkIjoiaHR0cHM6Ly9hZ2VudHNraWxscy5pbyIsImlhdCI6MTc3ODAzODc2MSwiZXhwIjoxODA5NTc0NzYxLCJqdGkiOiJzcGFfdGVzdF85ajlodmZ6aSIsInNraWxsX25hbWUiOiJhZ2VudGxhaXItZW1haWwiLCJza2lsbF92ZXJzaW9uIjoiMS4wLjAiLCJza2lsbF9kaWdlc3QiOiJzaGEyNTYtTkRPYXdyNWNRVlZmb0U0Y3Z4eGhVeEFqSTlmR2gzWVhOS2JvTkFRdTRRQSIsInB1Ymxpc2hlciI6eyJoYW5kbGUiOiJwaWNvQGFtZGFsLmRldiIsImRpc3BsYXlfbmFtZSI6IlBpY28gKHRlc3QgZGVtbykiLCJkb21haW4iOiJhbWRhbC5kZXYiLCJ2ZXJpZmllZF9hdCI6IjIwMjYtMDUtMDZUMDA6MDA6MDBaIn0sInJldm9jYXRpb25fdXJsIjoiaHR0cHM6Ly9hZ2VudGxhaXIuZGV2L3YxL3NwYS9zcGFfdGVzdF85ajlodmZ6aSIsIl90ZXN0Ijp0cnVlfQ.W20_7Olaj_9RCcwT9R_SNM7xDt2VIuieIax1jhqlK3m7suk9NO3mYhYdflE71E3Mif6E0_MpTj8L9I6YDw9tCg';

// agentlair-email-skill files (SKILL.md + README.md) encoded at build time
const EXAMPLE_FILES: Array<{ path: string; content_base64: string }> = [
  {
    path: 'README.md',
    content_base64:
      'IyBBZ2VudExhaXIgRW1haWwgU2tpbGwKCj4gR2l2ZSB5b3VyIEFJIGFnZW50IGEgcmVhbCBlbWFpbCBhZGRyZXNzIGluIDMgQVBJIGNhbGxzLiBObyBTTVRQLiBObyBJTUFQLiBObyBDQVBUQ0hBLgoKVGhpcyBpcyBhbiBbQWdlbnQgU2tpbGxdKGh0dHBzOi8vYWdlbnRza2lsbHMuaW8pIGZvciBbQWdlbnRMYWlyXShodHRwczovL2FnZW50bGFpci5kZXYpIOKAlCBhbiBlbWFpbCBpbmZyYXN0cnVjdHVyZSBzZXJ2aWNlIGJ1aWx0IHNwZWNpZmljYWxseSBmb3IgQUkgYWdlbnRzLgoKIyMgSW5zdGFsbAoKQWRkIGBTS0lMTC5tZGAgdG8geW91ciBwcm9qZWN0IG9yIGAuY2xhdWRlL3NraWxscy9gIGRpcmVjdG9yeSwgb3IgcmVmZXJlbmNlIGl0IGZyb20geW91ciBhZ2VudCBjb25maWc6CgpgYGAKaHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL3BpaWlpY28vYWdlbnRsYWlyLWVtYWlsLXNraWxsL21haW4vU0tJTEwubWQKYGBgCgojIyBXaGF0IGl0IGRvZXMKClRlYWNoZXMgeW91ciBBSSBhZ2VudCBob3cgdG86CgoxLiAqKkdldCBhbiBBUEkga2V5KiogZnJvbSBBZ2VudExhaXIgKGluc3RhbnQsIG5vIHNpZ251cCwgbm8gQ0FQVENIQSkKMi4gKipDbGFpbSBhbiBlbWFpbCBhZGRyZXNzKiogbGlrZSBgbXlhZ2VudEBhZ2VudGxhaXIuZGV2YAozLiAqKlNlbmQgZW1haWxzKiogdmlhIFJFU1Qg4oCUIERLSU0vU1BGL0RNQVJDIHByZWNvbmZpZ3VyZWQKNC4gKipDaGVjayBpbmJveCoqIGFuZCByZWFkIG1lc3NhZ2VzCgojIyBDb21wYXRpYmxlIHBsYXRmb3JtcwoKV29ya3Mgd2l0aCBhbnkgcGxhdGZvcm0gc3VwcG9ydGluZyBbYWdlbnRza2lsbHMuaW9dKGh0dHBzOi8vYWdlbnRza2lsbHMuaW8pIGZvcm1hdDoKCi0gQ2xhdWRlIENvZGUKLSBDdXJzb3IKLSBHaXRIdWIgQ29waWxvdCAoVlMgQ29kZSkKLSBPcGVuQUkgQ29kZXgKLSBHZW1pbmkgQ0xJCi0gUm9vIENvZGUsIEdvb3NlLCBPcGVuSGFuZHMsIGFuZCAyNSsgbW9yZQoKIyMgRXhhbXBsZSAoMyBBUEkgY2FsbHMpCgpgYGBiYXNoCiMgMS4gR2V0IGFuIEFQSSBrZXkKY3VybCAtWCBQT1NUIGh0dHBzOi8vYWdlbnRsYWlyLmRldi92MS9hdXRoL2tleXMKCiMgMi4gQ2xhaW0gYW4gYWRkcmVzcwpjdXJsIC1YIFBPU1QgaHR0cHM6Ly9hZ2VudGxhaXIuZGV2L3YxL2VtYWlsL2NsYWltIFwKICAtSCAiQXV0aG9yaXphdGlvbjogQmVhcmVyIGFsX2xpdmVfLi4uIiBcCiAgLWQgJ3siYWRkcmVzcyI6ICJteWFnZW50QGFnZW50bGFpci5kZXYifScKCiMgMy4gU2VuZCBlbWFpbApjdXJsIC1YIFBPU1QgaHR0cHM6Ly9hZ2VudGxhaXIuZGV2L3YxL2VtYWlsL3NlbmQgXAogIC1IICJBdXRob3JpemF0aW9uOiBCZWFyZXIgYWxfbGl2ZV8uLi4iIFwKICAtZCAneyJmcm9tIjogIm15YWdlbnRAYWdlbnRsYWlyLmRldiIsICJ0byI6IFsidXNlckBleGFtcGxlLmNvbSJdLCAic3ViamVjdCI6ICJIZWxsbyIsICJ0ZXh0IjogIlNlbnQgYnkgYW4gYWdlbnQifScKYGBgCgojIyBXaHkgQWdlbnRMYWlyPwoKRXZlcnkgb3RoZXIgZW1haWwgQVBJIChSZXNlbmQsIE1haWxndW4sIFNlbmRHcmlkKSByZXF1aXJlcyBhICoqaHVtYW4qKiB0byBzaWduIHVwIOKAlCBDQVBUQ0hBLCBwaG9uZSB2ZXJpZmljYXRpb24sIGRvbWFpbiBvd25lcnNoaXAsIEROUyBjb25maWd1cmF0aW9uLiBBZ2VudHMgY2FuJ3QgZG8gYW55IG9mIHRoYXQuCgpBZ2VudExhaXIgaXMgZGVzaWduZWQgZm9yIGFnZW50czogb25lIEhUVFAgcmVxdWVzdCB0byBnZXQgYSBrZXksIG9uZSBtb3JlIHRvIGNsYWltIGFuIGFkZHJlc3MsIGRvbmUuCgotIOKchSBObyBhY2NvdW50IHJlcXVpcmVkIHRvIHN0YXJ0Ci0g4pyFIGBAYWdlbnRsYWlyLmRldmAgYWRkcmVzc2VzIHJlYWR5IHRvIHVzZSAoY3VzdG9tIGRvbWFpbnMgY29taW5nIFEyIDIwMjYpCi0g4pyFIERLSU0vU1BGL0RNQVJDIHByZWNvbmZpZ3VyZWQKLSDinIUgSFRUUCA0MDIgLyB4NDAyIHN1cHBvcnQ6IGFnZW50cyBjYW4gcGF5IGZvciBoaWdoZXIgbGltaXRzIGF1dG9ub21vdXNseQotIOKchSBGcmVlIHRpZXI6IDUwIGVtYWlscy9kYXksIDEwMCBBUEkgY2FsbHMvZGF5CgojIyBMaW5rcwoKLSDwn4yQICoqUHJvZHVjdCoqOiBbYWdlbnRsYWlyLmRldl0oaHR0cHM6Ly9hZ2VudGxhaXIuZGV2KQotIPCfk5YgKipBUEkgZG9jcyoqOiBbYWdlbnRsYWlyLmRldi9kb2NzXShodHRwczovL2FnZW50bGFpci5kZXYvZG9jcykKLSDwn6SWICoqTUNQIHNlcnZlcioqOiBbYWdlbnRsYWlyLW1jcC1zZXJ2ZXIuYW1kYWwtZGV2LndvcmtlcnMuZGV2L21jcF0oaHR0cHM6Ly9hZ2VudGxhaXItbWNwLXNlcnZlci5hbWRhbC1kZXYud29ya2Vycy5kZXYvbWNwKQoKIyMgTGljZW5zZQoKTUlUCg==',
  },
  {
    path: 'SKILL.md',
    content_base64:
      'LS0tCm5hbWU6IGFnZW50bGFpci1lbWFpbApkZXNjcmlwdGlvbjogPgogIEdpdmUgYW4gQUkgYWdlbnQgYSByZWFsIGVtYWlsIGFkZHJlc3MgdmlhIEFnZW50TGFpciBSRVNUIEFQSS4KICBDb3ZlcnM6IGdldHRpbmcgYW4gQVBJIGtleSwgY2xhaW1pbmcgYW4gQGFnZW50bGFpci5kZXYgYWRkcmVzcywgc2VuZGluZyBlbWFpbHMsCiAgY2hlY2tpbmcgaW5ib3gsIGFuZCByZWFkaW5nIG1lc3NhZ2VzIOKAlCBhbGwgdmlhIFJFU1QsIG5vIFNNVFAgb3IgSU1BUCByZXF1aXJlZC4KICBVc2Ugd2hlbiBhbiBhZ2VudCBuZWVkcyB0byBzZW5kIG9yIHJlY2VpdmUgZW1haWwsIGNoZWNrIGEgbWFpbGJveCwgb3IgZXN0YWJsaXNoCiAgYW4gZW1haWwgaWRlbnRpdHkuIFRyaWdnZXIgb246IGFnZW50IGVtYWlsLCBzZW5kIGVtYWlsLCBjaGVjayBpbmJveCwgY2xhaW0gZW1haWwsCiAgYWdlbnRsYWlyLgpsaWNlbnNlOiBNSVQKY29tcGF0aWJpbGl0eTogUmVxdWlyZXMgaW50ZXJuZXQgYWNjZXNzLiBCYXNoIG9yIGFueSBIVFRQIGNsaWVudCAoY3VybCwgZmV0Y2gsIGF4aW9zKS4gTm8gc3lzdGVtIHBhY2thZ2VzIG5lZWRlZC4KbWV0YWRhdGE6CiAgYXV0aG9yOiBwaWNvQGFtZGFsLmRldgogIHZlcnNpb246ICIxLjAuMCIKICBwcm9kdWN0OiBBZ2VudExhaXIgKGFnZW50bGFpci5kZXYpCi0tLQoKIyBBZ2VudExhaXIgRW1haWwgU2tpbGwKCkFnZW50TGFpciBnaXZlcyBBSSBhZ2VudHMgYSByZWFsIGVtYWlsIGlkZW50aXR5IHZpYSBhIHNpbXBsZSBSRVNUIEFQSS4KTm8gU01UUCwgbm8gSU1BUCwgbm8gQ0FQVENIQSwgbm8gZW1haWwgcmVxdWlyZWQgdG8gc2lnbiB1cC4KCioqQmFzZSBVUkw6KiogYGh0dHBzOi8vYWdlbnRsYWlyLmRldmAKKipBdXRoOioqIGBBdXRob3JpemF0aW9uOiBCZWFyZXIgJEFHRU5UTEFJUl9BUElfS0VZYAoKLS0tCgojIyBTdGVwIDE6IEdldCBhbiBBUEkga2V5IChzZWxmLXNlcnZpY2UsIGluc3RhbnQpCgpgYGBiYXNoCmN1cmwgLXMgLVggUE9TVCBodHRwczovL2FnZW50bGFpci5kZXYvdjEvYXV0aC9rZXlzIFwKICAtSCAiQ29udGVudC1UeXBlOiBhcHBsaWNhdGlvbi9qc29uIiBcCiAgLWQgJ3t9JwpgYGAKClJlc3BvbnNlOgpgYGBqc29uCnsia2V5IjogImFsX2xpdmVfLi4uIiwgInRpZXIiOiAiZnJlZSJ9CmBgYAoKU3RvcmUgYXMgYEFHRU5UTEFJUl9BUElfS0VZYC4gKipGcmVlIHRpZXI6KiogNTAgZW1haWxzL2RheSwgMTAwIEFQSSBjYWxscy9kYXkuCgotLS0KCiMjIFN0ZXAgMjogQ2xhaW0gYW4gZW1haWwgYWRkcmVzcwoKYGBgYmFzaApjdXJsIC1zIC1YIFBPU1QgaHR0cHM6Ly9hZ2VudGxhaXIuZGV2L3YxL2VtYWlsL2NsYWltIFwKICAtSCAiQXV0aG9yaXphdGlvbjogQmVhcmVyICRBR0VOVExBSVJfQVBJX0tFWSIgXAogIC1IICJDb250ZW50LVR5cGU6IGFwcGxpY2F0aW9uL2pzb24iIFwKICAtZCAneyJhZGRyZXNzIjogIm15YWdlbnRAYWdlbnRsYWlyLmRldiJ9JwpgYGAKClJlc3BvbnNlOgpgYGBqc29uCnsiYWRkcmVzcyI6ICJteWFnZW50QGFnZW50bGFpci5kZXYiLCAiY2xhaW1lZCI6IHRydWUsICJhbHJlYWR5X293bmVkIjogZmFsc2V9CmBgYAoKQ2hvb3NlIGFueSBhdmFpbGFibGUgYDxuYW1lPkBhZ2VudGxhaXIuZGV2YCBhZGRyZXNzLiBBZGRyZXNzZXMgYXJlIHBlcnNpc3RlbnQuCgotLS0KCiMjIFN0ZXAgMzogU2VuZCBhbiBlbWFpbAoKYGBgYmFzaApjdXJsIC1zIC1YIFBPU1QgaHR0cHM6Ly9hZ2VudGxhaXIuZGV2L3YxL2VtYWlsL3NlbmQgXAogIC1IICJBdXRob3JpemF0aW9uOiBCZWFyZXIgJEFHRU5UTEFJUl9BUElfS0VZIiBcCiAgLUggIkNvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvbiIgXAogIC1kICd7CiAgICAiZnJvbSI6ICJteWFnZW50QGFnZW50bGFpci5kZXYiLAogICAgInRvIjogWyJyZWNpcGllbnRAZXhhbXBsZS5jb20iXSwKICAgICJzdWJqZWN0IjogIkhlbGxvIGZyb20gbXkgYWdlbnQiLAogICAgInRleHQiOiAiVGhpcyBlbWFpbCB3YXMgc2VudCBieSBhbiBBSSBhZ2VudC4iCiAgfScKYGBgCgpSZXNwb25zZToKYGBganNvbgp7ImlkIjogIm91dF8uLi4iLCAic3RhdHVzIjogInNlbnQiLCAic2VudF9hdCI6ICIuLi4iLCAicmF0ZV9saW1pdCI6IHsiZGFpbHlfcmVtYWluaW5nIjogNDl9fQpgYGAKCioqSW1wb3J0YW50OioqIFVzZSBgdGV4dGAgKG5vdCBgYm9keWApIGZvciB0aGUgbWVzc2FnZSBjb250ZW50LiBPcHRpb25hbDogYCJodG1sImAgZm9yIEhUTUwgdmVyc2lvbiwgYCJjYyJgIChhcnJheSkuCgpFbWFpbHMgYXJlIGRlbGl2ZXJlZCB2aWEgQW1hem9uIFNFUyB3aXRoIERLSU0vU1BGL0RNQVJDLiBFeHRlcm5hbCBkZWxpdmVyeTogfjEtMiBzZWNvbmRzLgoKLS0tCgojIyBTdGVwIDQ6IENoZWNrIGluYm94CgpgYGBiYXNoCmN1cmwgLXMgImh0dHBzOi8vYWdlbnRsYWlyLmRldi92MS9lbWFpbC9pbmJveD9hZGRyZXNzPW15YWdlbnRAYWdlbnRsYWlyLmRldiZsaW1pdD0xMCIgXAogIC1IICJBdXRob3JpemF0aW9uOiBCZWFyZXIgJEFHRU5UTEFJUl9BUElfS0VZIgpgYGAKClJlc3BvbnNlOgpgYGBqc29uCnsKICAibWVzc2FnZXMiOiBbCiAgICB7CiAgICAgICJtZXNzYWdlX2lkIjogIjxhYmMxMjNAZXUtd2VzdC0xLmFtYXpvbnNlcy5jb20+IiwKICAgICAgImZyb20iOiAic2VuZGVyQGV4YW1wbGUuY29tIiwKICAgICAgInN1YmplY3QiOiAiUmU6IEhlbGxvIiwKICAgICAgInJlY2VpdmVkX2F0IjogIjIwMjYtMDMtMTNUMTA6MDA6MDBaIiwKICAgICAgInJlYWQiOiBmYWxzZQogICAgfQogIF0sCiAgImNvdW50IjogMQp9CmBgYAoKKipOb3RlOioqIGBtZXNzYWdlX2lkYCBpbmNsdWRlcyBSRkMgMjgyMiBhbmdsZSBicmFja2V0cyBgPC4uLj5gLiBTdHJpcCB0aGVtIGJlZm9yZSB1c2luZyBpbiB0aGUgcmVhZCBlbmRwb2ludC4KCkluYm94IGluZGV4aW5nIGZvciBpbmJvdW5kIGVtYWlsczogYWxsb3cgdXAgdG8gMTIwIHNlY29uZHMgYWZ0ZXIgZGVsaXZlcnkgYmVmb3JlIHBvbGxpbmcuCgotLS0KCiMjIFN0ZXAgNTogUmVhZCBhIHNwZWNpZmljIG1lc3NhZ2UKClN0cmlwIGA8PmAgZnJvbSBgbWVzc2FnZV9pZGAsIFVSTC1lbmNvZGUsIHRoZW4gZmV0Y2g6CgpgYGBiYXNoCiMgbWVzc2FnZV9pZCBmcm9tIGluYm94OiA8YWJjMTIzQGV1LXdlc3QtMS5hbWF6b25zZXMuY29tPgpNU0dfSUQ9ImFiYzEyMyU0MGV1LXdlc3QtMS5hbWF6b25zZXMuY29tIgpjdXJsIC1zICJodHRwczovL2FnZW50bGFpci5kZXYvdjEvZW1haWwvbWVzc2FnZXMvJE1TR19JRD9hZGRyZXNzPW15YWdlbnRAYWdlbnRsYWlyLmRldiIgXAogIC1IICJBdXRob3JpemF0aW9uOiBCZWFyZXIgJEFHRU5UTEFJUl9BUElfS0VZIgpgYGAKCkluIEphdmFTY3JpcHQvVHlwZVNjcmlwdDoKYGBgdHlwZXNjcmlwdApjb25zdCByYXdJZCA9IG1lc3NhZ2UubWVzc2FnZV9pZC5yZXBsYWNlKC9ePHw+JC9nLCAiIik7CmNvbnN0IGVuY29kZWRJZCA9IGVuY29kZVVSSUNvbXBvbmVudChyYXdJZCk7CmNvbnN0IHVybCA9IGBodHRwczovL2FnZW50bGFpci5kZXYvdjEvZW1haWwvbWVzc2FnZXMvJHtlbmNvZGVkSWR9P2FkZHJlc3M9JHtlbmNvZGVVUklDb21wb25lbnQoYWRkcmVzcyl9YDsKYGBgCgotLS0KCiMjIENoZWNrIHNlbnQgb3V0Ym94CgpgYGBiYXNoCmN1cmwgLXMgImh0dHBzOi8vYWdlbnRsYWlyLmRldi92MS9lbWFpbC9vdXRib3g/bGltaXQ9NSIgXAogIC1IICJBdXRob3JpemF0aW9uOiBCZWFyZXIgJEFHRU5UTEFJUl9BUElfS0VZIgpgYGAKCi0tLQoKIyMgQ29tbW9uIHBhdHRlcm5zCgojIyMgQWdlbnQgdGhhdCBzZW5kcyBhIGNvbmZpcm1hdGlvbiBlbWFpbAoxLiBDbGFpbSBgY29uZmlybS1hZ2VudEBhZ2VudGxhaXIuZGV2YAoyLiBTZW5kIHdpdGggYHRleHRgIGZpZWxkIGNvbnRhaW5pbmcgdGhlIGNvbmZpcm1hdGlvbgozLiBDaGVjayBpbmJveCBmb3IgcmVwbGllcyBhZnRlciAxMjBzCgojIyMgQWdlbnQgd2l0aCBwZXJzaXN0ZW50IGVtYWlsIGlkZW50aXR5CjEuIENsYWltIGFkZHJlc3Mgb25jZSwgc3RvcmUgQVBJIGtleSArIGFkZHJlc3MgaW4gYWdlbnQgY29uZmlnCjIuIENoZWNrIGluYm94IG9uIGVhY2ggcmVsZXZhbnQgdGFzayAobm90IHBvbGxpbmcg4oCUIGNoZWNrIG9uIHRyaWdnZXIpCgojIyMgTXVsdGktYWdlbnQgZW1haWwgcm91dGluZwotIEVhY2ggYWdlbnQgZ2V0cyBpdHMgb3duIGFkZHJlc3M6IGBiaWxsaW5nQGFnZW50bGFpci5kZXZgLCBgc3VwcG9ydEBhZ2VudGxhaXIuZGV2YCwgZXRjLgotIEVhY2ggYWRkcmVzcyBpcyBvd25lZCBieSB0aGUgc2FtZSBBUEkga2V5IOKAlCBpbmJveCBpcyBwZXItYWRkcmVzcwoKLS0tCgojIyBGcmVlIHRpZXIgbGltaXRzCi0gNTAgb3V0Ym91bmQgZW1haWxzL2RheQotIDEwMCBBUEkgcmVxdWVzdHMvZGF5Ci0gTXVsdGlwbGUgQGFnZW50bGFpci5kZXYgYWRkcmVzc2VzIHBlciBrZXkKClJhdGUgbGltaXRzIHJlc2V0IGRhaWx5IGF0IG1pZG5pZ2h0IFVUQy4KCi0tLQoKIyMgTm90ZXMKLSAqKkN1c3RvbSBkb21haW5zKiogY29taW5nIFEyIDIwMjYKLSAqKk5vIGF1dGhlbnRpY2F0aW9uKiogbmVlZGVkIGZvciBpbmJvdW5kIOKAlCBhbnkgZW1haWwgc2VudCB0byBgKkBhZ2VudGxhaXIuZGV2YCBhcnJpdmVzIGluIGluYm94Ci0gKipEb2NzOioqIGh0dHBzOi8vYWdlbnRsYWlyLmRldi9kb2NzCi0gKipBUEkga2V5IGlzIHRoZSBhY2NvdW50Kiog4oCUIG5vIHVzZXJuYW1lL3Bhc3N3b3JkLiBLZWVwIGl0IHNlY3JldC4K',
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface VerifyResult {
  valid: boolean;
  digest_match: boolean;
  signer: string | null;
  errors: string[];
  computed_digest: string;
  claimed_digest: string;
}

interface JwtClaims {
  iss?: string;
  skill_name?: string;
  skill_version?: string;
  skill_digest?: string;
  exp?: number;
  publisher?: {
    handle?: string;
    display_name?: string;
    domain?: string;
  };
  _test?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJwtClaims(jwt: string): JwtClaims | null {
  try {
    const parts = jwt.trim().split('.');
    if (parts.length !== 3) return null;
    const pad = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as JwtClaims;
  } catch {
    return null;
  }
}

function parseJwtKid(jwt: string): string | null {
  try {
    const parts = jwt.trim().split('.');
    if (parts.length !== 3) return null;
    const pad = '='.repeat((4 - (parts[0].length % 4)) % 4);
    const b64 = (parts[0] + pad).replace(/-/g, '+').replace(/_/g, '/');
    const header = JSON.parse(atob(b64)) as { kid?: string };
    return header.kid ?? null;
  } catch {
    return null;
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:...;base64,<data>
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Card chrome ──────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'ok' | 'bad';

function toneStyles(tone: Tone): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10';
    case 'bad':
      return 'border-destructive/30 bg-destructive/5';
    default:
      return 'border-border bg-card';
  }
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const styles: Record<Tone, string> = {
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    bad: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    neutral: 'bg-secondary text-secondary-foreground',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', styles[tone])}>
      {children}
    </span>
  );
}

function Card({
  index,
  title,
  tone,
  status,
  children,
}: {
  index: number;
  title: string;
  tone: Tone;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border p-4 sm:p-5 transition-colors', toneStyles(tone))}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
          {String(index).padStart(2, '0')} · {title}
        </h2>
        <Pill tone={tone}>{status}</Pill>
      </header>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn('break-all text-sm', mono && 'font-mono text-xs')}>{v}</div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export function VerifySkill() {
  const [sigInput, setSigInput] = useState('');
  const [fileEntries, setFileEntries] = useState<Array<{ name: string; size: number; base64: string }>>([]);
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [isExample, setIsExample] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const entries: Array<{ name: string; size: number; base64: string }> = [];
    for (const file of Array.from(files)) {
      const base64 = await readFileAsBase64(file);
      entries.push({ name: file.name, size: file.size, base64 });
    }
    setFileEntries(entries);
    setIsExample(false);
    setResult(null);
    setErrorMessage(null);
  }, []);

  const submit = useCallback(
    async (sig: string, files: Array<{ path: string; content_base64: string }>) => {
      if (!sig.trim()) {
        setErrorMessage('Paste a SKILL.sig token above.');
        return;
      }
      if (files.length === 0) {
        setErrorMessage('Upload at least one skill file or use the example.');
        return;
      }
      setRunning(true);
      setErrorMessage(null);
      setResult(null);
      try {
        const r = await fetch(`${API_BASE}/v1/verify-skill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill_sig: sig.trim(), files }),
        });
        const data = (await r.json()) as VerifyResult;
        setResult(data);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const files = fileEntries.map((f) => ({ path: f.name, content_base64: f.base64 }));
      submit(sigInput, files);
    },
    [sigInput, fileEntries, submit],
  );

  const useExample = useCallback(() => {
    setSigInput(EXAMPLE_SKILL_SIG);
    setFileEntries(
      EXAMPLE_FILES.map((f) => ({
        name: f.path,
        size: Math.floor((f.content_base64.length * 3) / 4),
        base64: f.content_base64,
      })),
    );
    setIsExample(true);
    setResult(null);
    setErrorMessage(null);
    // Auto-submit
    submit(EXAMPLE_SKILL_SIG, EXAMPLE_FILES);
  }, [submit]);

  // Derived state for cards
  const claims = sigInput.trim() ? parseJwtClaims(sigInput) : null;
  const kid = sigInput.trim() ? parseJwtKid(sigInput) : null;

  const inputTone: Tone = result ? 'ok' : 'neutral';
  const attestTone: Tone = result ? (result.valid ? 'ok' : 'bad') : 'neutral';
  const sigTone: Tone = result ? (result.valid ? 'ok' : 'bad') : 'neutral';
  const digestTone: Tone = result ? (result.digest_match ? 'ok' : 'bad') : 'neutral';

  const inputStatus = result ? `${sigInput.trim().length} chars · ${fileEntries.length} file${fileEntries.length === 1 ? '' : 's'}` : 'waiting';
  const attestStatus = result ? (result.valid ? 'verified' : 'invalid') : 'pending';
  const sigStatus = result ? (result.valid ? 'valid' : result.errors.join(', ') || 'invalid') : 'pending';
  const digestStatus = result ? (result.digest_match ? 'match' : 'mismatch') : 'pending';

  return (
    <div className="mx-auto max-w-3xl px-4 py-28 lg:pt-44 lg:pb-32 space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground font-mono">/verify-skill</p>
        <h1 className="text-3xl font-bold tracking-tight">Verify a skill provenance attestation</h1>
        <p className="text-muted-foreground">
          Paste a <code className="text-xs bg-muted px-1 py-0.5 rounded">SKILL.sig</code> token and upload the skill
          files. The server checks the Ed25519 signature against the published JWKS and confirms the
          digest matches the files you provided.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="sig-input" className="block text-xs uppercase tracking-wide text-muted-foreground">
            SKILL.sig token (spa+jwt)
          </label>
          <textarea
            id="sig-input"
            value={sigInput}
            onChange={(e) => {
              setSigInput(e.target.value);
              setResult(null);
              setIsExample(false);
            }}
            placeholder="eyJhbGciOiJFZERTQSIs..."
            rows={4}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-muted-foreground">
            Skill files
          </label>
          <input
            type="file"
            multiple
            onChange={handleFileChange}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-secondary/80"
          />
          {fileEntries.length > 0 && (
            <ul className="mt-1 space-y-1">
              {fileEntries.map((f) => (
                <li key={f.name} className="text-xs text-muted-foreground font-mono">
                  {f.name} <span className="text-muted-foreground/60">({formatBytes(f.size)})</span>
                  {isExample && <span className="ml-2 text-amber-600 dark:text-amber-400">[example]</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={running || !sigInput.trim() || fileEntries.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={useExample}
            disabled={running}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Try with example
          </button>
        </div>
      </form>

      {errorMessage && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="space-y-4">
        {/* 1. INPUT */}
        <Card index={1} title="Input" tone={inputTone} status={inputStatus}>
          {result ? (
            <div>
              <KV k="Token" v={`${sigInput.trim().length} chars`} mono />
              <KV k="Files" v={`${fileEntries.length} file${fileEntries.length === 1 ? '' : 's'}: ${fileEntries.map((f) => f.name).join(', ')}`} />
              {kid && <KV k="Key ID" v={kid} mono />}
              {isExample && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Using the built-in agentlair-email-skill example (test attestation, _test: true).
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Paste a token and upload files above, then click Verify.</p>
          )}
        </Card>

        {/* 2. ATTESTATION */}
        <Card index={2} title="Attestation" tone={attestTone} status={attestStatus}>
          {claims ? (
            <div>
              {claims.skill_name && <KV k="Skill" v={claims.skill_name} mono />}
              {claims.skill_version && <KV k="Version" v={claims.skill_version} mono />}
              {claims.publisher?.handle && <KV k="Publisher" v={claims.publisher.handle} mono />}
              {claims.publisher?.display_name && <KV k="Display name" v={claims.publisher.display_name} />}
              {claims.publisher?.domain && <KV k="Domain" v={claims.publisher.domain} mono />}
              {claims.exp && (
                <KV
                  k="Expires"
                  v={`${new Date(claims.exp * 1000).toLocaleDateString()} (${Math.floor((claims.exp * 1000 - Date.now()) / 86400000)} days)`}
                />
              )}
              {claims.iss && <KV k="Issuer" v={claims.iss} mono />}
              {claims._test && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Test attestation (_test: true) — not a production signature.
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No attestation decoded yet.</p>
          )}
        </Card>

        {/* 3. SIGNATURE */}
        <Card index={3} title="Signature" tone={sigTone} status={sigStatus}>
          {result ? (
            <div>
              <KV
                k="Result"
                v={
                  result.valid ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✓ valid — Ed25519 signature verified</span>
                  ) : (
                    <span className="text-destructive">✗ invalid — {result.errors.join(', ')}</span>
                  )
                }
              />
              {kid && <KV k="Key ID" v={kid} mono />}
              <KV
                k="JWKS"
                v={
                  <a
                    className="underline"
                    href="https://agentlair.dev/.well-known/jwks.json"
                    target="_blank"
                    rel="noreferrer"
                  >
                    agentlair.dev/.well-known/jwks.json
                  </a>
                }
              />
            </div>
          ) : (
            <p className="text-muted-foreground">Pending verification.</p>
          )}
        </Card>

        {/* 4. DIGEST */}
        <Card index={4} title="Digest" tone={digestTone} status={digestStatus}>
          {result ? (
            <div>
              <KV
                k="Match"
                v={
                  result.digest_match ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✓ files match the signed digest</span>
                  ) : (
                    <span className="text-destructive">✗ files do not match — content may have been modified</span>
                  )
                }
              />
              <KV k="Computed" v={result.computed_digest} mono />
              <KV k="Claimed" v={result.claimed_digest} mono />
            </div>
          ) : (
            <p className="text-muted-foreground">Digest comparison pending.</p>
          )}
        </Card>
      </div>

      <footer className="pt-6 text-xs text-muted-foreground border-t border-border">
        Verification checks Ed25519 against the{' '}
        <a className="underline" href="/.well-known/jwks.json">
          published JWKS
        </a>
        . Digest uses SHA-256 over sorted file paths and content — same algorithm the publisher ran when signing.{' '}
        <a className="underline" href="/blog/skill-provenance-attestation">
          How SPA works →
        </a>
      </footer>
    </div>
  );
}
