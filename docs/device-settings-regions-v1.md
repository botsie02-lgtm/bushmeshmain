# BushMesh Device & Region Settings v1

Branch: `feature/device-settings-regions-v1`, based on integration commit
`e8ab74b522ca288ac017d9fb9d20636395e24fc8`.

## Screen layout and ownership

Device Hub → Overview / Background Radio / Radio Profile / GPS /
Offline Maps / Diagnostics / BLE Tools.

- Background Radio reuses `NativeRadioSetupScreen`, the application-lifetime
  `AppRadioConnectionService` and `NativeMeshCoreSessionCoordinator`.
  It does not open a second BLE connection or restart the Android service on
  Device screen mount/unmount.
- Legacy BLE Tools is disabled when Android is taking over, active or stopping.
- GPS embeds the existing `LocationScreen`. No frequency is inferred from GPS.
- Offline Maps embeds the existing `MapPackCatalogPanel`; field diagnostics
  reuse the existing support/export components.
- Five-tab app-shell navigation belongs to the parallel app-shell branch, not
  this branch. `App.tsx` is deliberately untouched.

## MeshCore preset source / frequency values

Official MeshCore docs (`https://docs.meshcore.io/radio_presets/`)
state that the app's live community presets come from
`https://api.meshcore.nz/api/v1/config` and may change independently of app
or firmware releases. The official documentation includes an EXAMPLE for
Australia (Narrow): **916.575 MHz / 62.5 kHz / SF7 / CR7**. This is bundled
only as an explicit **offline documentation example**, not a claim of
current live preset values (community reports also describe alternative CRs).

`regionProfiles.ts` parses complete structured four-field records from the
MeshCore API, validates them with the existing MeshCore radio validation,
rejects malformed entries, stores source URL/retrieval timestamp and a
deterministic content-revision marker. Optional path hash recommendations
are shown but never silently written. The current MeshCore presets do
not guarantee TX-power values, so an API-derived resulting profile keeps
the **verified current device TX**, never guesses a power setting.

The full comparison includes frequency, bandwidth, SF, CR and TX. Apply
remains unavailable until SELF_INFO/DEVICE_INFO are explicitly refreshed
for the existing live session, and is followed by the existing
`applyAndVerifyRadioSettings` plus an additional exact compare against
the returned SELF_INFO. Errors invalidate the fresh-read guard. The
previous pre-write verified profile is shown only for the same public
node identity prefix, and is never automatically restored.

The native persistence module reuses the existing Android encrypted
SharedPreferences / Android Keystore implementation with a **distinct**
device-preferences key and AAD. Its whitelist-only versioned schema
stores selected preset ID, Device display units and a previous verified
RF profile scoped to the public identity reference. It does not store
PSKs, channel keys, Security v1 key material or the connected BLE address.

## Regulatory and hardware checks

ACMA: `https://www.acma.gov.au/licences/low-interference-potential-devices-lipd-class-licence`.

Australia's **Radiocommunications (Low Interference Potential Devices) Class
Licence 2025** sets operating rules, band/class limits and technical
requirements. Do not infer authorisation from a MeshCore preset, or equate
chip TX dBm with EIRP (power amplifiers, cable losses and antenna gain
matter). Check regional limitations, device certification, duty cycle
where relevant and the Murchison radio-quiet zone in WA. No GPS-driven
automatic RF changes or universal legal-power ceiling is implemented.

Manual settings use existing parameter validation, exact frequency/
bandwidth scaling and hardware-reported `maxTxPower`. They cannot modify
client repeat, path-hash mode, credentials, convoy membership or identity.

## Integration dependencies

1. **App shell:** place Device Hub into the future five-tab shell, remove
   the redundant top-level GPS tab, and keep map inside Drive. Do not
   alter `App.tsx` in this feature branch.
2. **MeshCore app config provider:** the source's catalog is an optional
   online fetch; when unreachable, the UI explicitly labels its bundled
   documentation example as not live. Live-preset caching/refresh policy
   can be refined without changing the wire contract.
3. **MeshCore command-port owner:** optional `network_settings.path_hash_size`
   in some region presets cannot be applied by the current
   `applyAndVerifyRadioSettings` contract. If product requires it, expose
   read/set/verify as an integration port owned by that module, not a
   second MeshCore command writer.
4. **Hardware:** two physical MeshCore nodes and real Android BLE handoff/
   reboot, persistence across app restarts, firmware-specific max TX,
   actual PA/EIRP and cross-device interoperability remain field checks.

## Validation targets

`__tests__/deviceRegionProfiles.test.ts` covers API parsing, incomplete
presets, revision changes, proposed complete profiles, TX caps, manual
validation and exact read-back. `__tests__/devicePreferences.test.ts`
covers version migration rejection, secret stripping, ordered persistence
and failure. `__tests__/deviceConnectionHealth.test.ts` covers reconnect,
busy/error phases and ownership continuity. Existing
`nativeMeshCoreRadioSettings` and `appRadioNativeStopLifecycle` tests
remain the hardware-command and ownership regression suites.
