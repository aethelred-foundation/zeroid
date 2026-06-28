import {
  createDigitalSeal,
  verifyDigitalSeal,
  getDigitalSeal,
} from "@/lib/aethelred/seals";
import { getSealsModule } from "@/lib/aethelred/client";

jest.mock("@/lib/aethelred/client");
const mockedGetSealsModule = getSealsModule as jest.MockedFunction<
  typeof getSealsModule
>;

describe("Digital Seals adapter", () => {
  afterEach(() => jest.clearAllMocks());

  it("createDigitalSeal delegates to SealsModule.create", async () => {
    const seal = { id: "s1", jobId: "j1" };
    const create = jest.fn().mockResolvedValue(seal);
    mockedGetSealsModule.mockReturnValue({ create } as never);

    const result = await createDigitalSeal({ jobId: "j1" });
    expect(create).toHaveBeenCalledWith({ jobId: "j1" });
    expect(result).toBe(seal);
  });

  it("verifyDigitalSeal delegates to SealsModule.verify", async () => {
    const verify = jest.fn().mockResolvedValue({ valid: true });
    mockedGetSealsModule.mockReturnValue({ verify } as never);

    const result = await verifyDigitalSeal("s1");
    expect(verify).toHaveBeenCalledWith("s1");
    expect(result.valid).toBe(true);
  });

  it("getDigitalSeal delegates to SealsModule.get", async () => {
    const seal = { id: "s1", jobId: "j1" };
    const get = jest.fn().mockResolvedValue(seal);
    mockedGetSealsModule.mockReturnValue({ get } as never);

    const result = await getDigitalSeal("s1");
    expect(get).toHaveBeenCalledWith("s1");
    expect(result).toBe(seal);
  });
});
