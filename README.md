# proyecto_recetas
Blockchain Solutions for Secure E-Prescription Systems

A verifiable e-prescription system built on an Ethereum L2 (Base Sepolia). Doctors sign prescriptions with a passkey — no wallet, no seed phrase, no ETH — thanks to ERC-4337 smart accounts and a sponsoring paymaster. Pharmacies scan a QR code, verify the prescriber's credential on-chain through the Ethereum Attestation Service, and dispense. A second attempt to dispense the same prescription reverts. Clinical content stays encrypted off-chain; only a content hash and a per-prescription salted commitment go on-chain.

Built for an Ethereum buildathon in Cochabamba, Bolivia.

**Architecture documentation: [docs/README.md](docs/README.md)**
