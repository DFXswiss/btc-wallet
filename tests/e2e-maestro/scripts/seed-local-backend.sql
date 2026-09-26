-- Makes the Maestro Spark test identity tradable on a local DFX stack.
-- Bind :addr to that identity's Spark address (psql -v addr=...).
-- Run only against the local stack, never against dev or prod.
-- Does not create deposit addresses; the stack must already have free Spark
-- deposits (POST /v1/deposit) and Spark/BTC with sellable = true.

UPDATE user_data
SET "accountType"       = 'Personal',
    status              = 'Active',
    mail                = 'maestro-e2e-spark@invalid.example',
    firstname           = 'Maestro',
    surname             = 'E2E',
    street              = 'Disposable Simulation Street',
    location            = 'Zurich',
    zip                 = '8000',
    phone               = '+41000000000',
    "kycStatus"         = 'Completed',
    "kycLevel"          = 50,
    "kycHash"           = COALESCE("kycHash", gen_random_uuid()::text),
    "kycType"           = 'DFX',
    "depositLimit"      = 1000,
    "tradeApprovalDate" = now(),
    "countryId"         = 41,
    "languageId"        = 2,
    "currencyId"        = 2
WHERE id = (SELECT "userDataId" FROM "user" WHERE address = :'addr');
