import {
  normalizeSchemaRegistryPage,
  normalizeSchemaRegistryRecord,
  SchemaRegistryResponseContractError,
} from "@/lib/schemas/registry";

const schemaRecord = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.2.0",
  description: "An approved organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: {
      legalName: { type: "string" },
      registrationNumber: { type: "string" },
    },
    required: ["legalName", "registrationNumber"],
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "APPROVED",
  approvalVotes: 4,
  rejectionVotes: 1,
  voters: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

describe("schema registry response normalization", () => {
  it("normalizes the complete backend schema-governance record", () => {
    expect(normalizeSchemaRegistryRecord(schemaRecord, "APPROVED")).toEqual(
      schemaRecord,
    );
  });

  it.each([
    ["id", "not-a-uuid"],
    ["version", "v1"],
    ["status", "ACTIVE"],
    ["approvalVotes", -1],
    ["updatedAt", "yesterday"],
  ])("rejects an invalid %s field", (field, value) => {
    expect(() =>
      normalizeSchemaRegistryRecord({ ...schemaRecord, [field]: value }),
    ).toThrow(SchemaRegistryResponseContractError);
  });

  it("rejects a schema definition without a properties object", () => {
    expect(() =>
      normalizeSchemaRegistryRecord({
        ...schemaRecord,
        schemaDefinition: { type: "object" },
      }),
    ).toThrow(/schemaDefinition\.properties/);
  });

  it("fails closed if the approved endpoint returns another status", () => {
    expect(() =>
      normalizeSchemaRegistryRecord(
        { ...schemaRecord, status: "PROPOSED" },
        "APPROVED",
      ),
    ).toThrow(/while "APPROVED" was requested/);
  });

  it("normalizes a consistent backend pagination envelope", () => {
    expect(
      normalizeSchemaRegistryPage(
        [schemaRecord],
        { page: 1, limit: 1, total: 2, totalPages: 2 },
        "APPROVED",
      ),
    ).toEqual({
      items: [schemaRecord],
      total: 2,
      page: 1,
      pageSize: 1,
      hasMore: true,
    });
  });

  it("rejects missing or inconsistent pagination metadata", () => {
    expect(() =>
      normalizeSchemaRegistryPage([schemaRecord], undefined, "APPROVED"),
    ).toThrow(/pagination must be an object/);

    expect(() =>
      normalizeSchemaRegistryPage(
        [schemaRecord],
        { page: 1, limit: 10, total: 1, totalPages: 2 },
        "APPROVED",
      ),
    ).toThrow(/totalPages/);
  });

  it("identifies a malformed item by its list index", () => {
    expect(() =>
      normalizeSchemaRegistryPage(
        [schemaRecord, { ...schemaRecord, id: "invalid" }],
        { page: 1, limit: 10, total: 2, totalPages: 1 },
        "APPROVED",
      ),
    ).toThrow(/list item 1/);
  });
});
