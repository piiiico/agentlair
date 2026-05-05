-- Migration 0011: store the original COSE_Sign1 signed statement bytes
-- alongside each PoPA attestation, so the public verifier can render the
-- exact bytes that were signed (verification cannot be reconstructed from
-- popa_attestations alone — the original timestamp had ms precision that
-- was not preserved as a column).
--
-- Forward-only: legacy rows will have NULL bytes and the verifier shows
-- them as "archived without statement bytes". New emissions populate it.

ALTER TABLE popa_attestations
  ADD COLUMN signed_statement_cbor TEXT;
