import { useMemo } from 'react';
import { pharmacyConfigResult, type PharmacyConfig } from './infrastructure/config/env';
import { createPharmacyServices } from './presentation/composition/pharmacy-services';
import { PharmacyApp } from './presentation/PharmacyApp';
import { ConfigurationScreen } from './presentation/screens/ConfigurationScreen';

/**
 * Application entry point.
 *
 * `pharmacyConfigResult` is evaluated at module load and NEVER throws: an app
 * that crashed while loading its own bundle could not render the message
 * explaining why. Today `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol has run, so the configuration branch below IS
 * the branch this app takes — and it has to read as deliberate, not broken.
 */
export function App() {
  if (!pharmacyConfigResult.ok) {
    return <ConfigurationScreen error={pharmacyConfigResult.error} />;
  }

  return <ConfiguredApp config={pharmacyConfigResult.config} />;
}

/**
 * Split from `App` so the adapters are built exactly once, behind `useMemo`,
 * without a hook sitting under a conditional return.
 */
function ConfiguredApp({ config }: { config: PharmacyConfig }) {
  const services = useMemo(() => createPharmacyServices(config), [config]);

  return <PharmacyApp services={services} />;
}
