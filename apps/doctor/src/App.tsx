import { useMemo } from 'react';
import { doctorConfigResult, type DoctorConfig } from './infrastructure/config/env';
import { createDoctorServices } from './presentation/composition/doctor-services';
import { DoctorApp } from './presentation/DoctorApp';
import { ConfigurationScreen } from './presentation/screens/ConfigurationScreen';

/**
 * Application entry point.
 *
 * `doctorConfigResult` is evaluated at module load and NEVER throws: an app
 * that crashed while loading its own bundle could not render the message
 * explaining why. Today `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol has run, so the configuration branch below IS
 * the branch this app takes — and it has to read as deliberate, not broken.
 *
 * Mirrors apps/pharmacy/src/App.tsx.
 */
export function App() {
  if (!doctorConfigResult.ok) {
    return <ConfigurationScreen error={doctorConfigResult.error} />;
  }

  return <ConfiguredApp config={doctorConfigResult.config} />;
}

/**
 * Split from `App` so the adapters are built exactly once, behind `useMemo`,
 * without a hook sitting under a conditional return.
 */
function ConfiguredApp({ config }: { config: DoctorConfig }) {
  const services = useMemo(() => createDoctorServices(config), [config]);

  return <DoctorApp services={services} />;
}
