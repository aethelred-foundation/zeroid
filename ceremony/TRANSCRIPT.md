# ZeroID trusted-setup ceremony — transcript

Append-only public record of the Groth16 phase-2 ceremony. Each row is one
contribution to one circuit by one **distinct, independent** participant. Anyone
can re-derive these hashes and verify the chain with `scripts/04-verify.sh`.

- **Curve / system:** BN254 / Groth16
- **Phase-1 (Powers of Tau):** community Perpetual Powers of Tau, power 14 (`ptau/pot14.ptau`)
- **Circuits (constraints):** `eligibility_context_proof` (9374), `age_proof` (9261), `residency_proof` (9302), `credit_tier_proof` (9539)
- **Scope:** testnet. Mainnet requires ≥1 external independent contributor + public audit.

Contribution #1 was made by the coordinator (`ramesh-coordinator`) using fresh
`openssl rand` OS-CSPRNG entropy, not retained. Subsequent rows are appended by
`scripts/03-contribute.sh` as each participant contributes, and the beacon rows
by `scripts/05-finalize.sh`. New rows continue the table below.

| Timestamp (UTC) | Circuit | # | Contributor | Contribution hash (blake2b) |
| --------------- | ------- | - | ----------- | --------------------------- |
| 2026-07-08T16:16Z | `eligibility_context_proof` | 1 | ramesh-coordinator | `f105eb7e4d104d2d19bd3ff871ccacdc3e52c565c8f1c7c52a887ece55a8e761cde945fda5e21f5eeab77a8610c18c7fda62904737f56a0b66c5d6de1226930d` |
| 2026-07-08T16:16Z | `age_proof` | 1 | ramesh-coordinator | `070c65c188bb20508d188dccb69fb3e5504e754929ed7191f187878854a2ff9c7e2ec19689e8e56862717f690fa3fb84d7b0c85cea44143826c0cfa6a139b2c2` |
| 2026-07-08T16:16Z | `residency_proof` | 1 | ramesh-coordinator | `7d4a908ab1a4d068fd71a4275cd84568dbe80c7b82bc676b646b3b12f02e83c41be6a4d2b1ff941093023c7ac4ceb34e38f49071ed50aec0fa0496eb73151789` |
| 2026-07-08T16:16Z | `credit_tier_proof` | 1 | ramesh-coordinator | `42eb2338c64c13d53030a1d694c9e51ccd2f3932ee7ab7d9936b50df25d860d601eae3ce4500b2edb106330f699f26de2e68e77bcbb35470e2d52a714fd5fd2a` |
