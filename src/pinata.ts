import { PinataSDK, VectorizeQueryResponse, VectorQueryMatch } from "pinata";

export const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY,
  pinataGatewayKey: process.env.PINATA_GATEWAY_KEY,
});


export const fetchVector = async (dataUrl: string) => {
  try {
    const res = await fetch(dataUrl);

    if (!res.ok) throw Error("Errorin fetching dataFile");
    const data = await res.json();
    console.log("[vector dat fetched]");
    return data;
  } catch (error) {
    console.log(error);
  }
};
// (async () => {
//   await fetchVector(
//     "https://gateway.pinata.cloud/ipfs/bafkreifssswwccumuwkjuutz2jqaxflymxf4fdx46i6esodno44isgc7oi"
//   );
// })();

export const convertFile = async (cid: string) => {
  const url = await pinata.gateways.public.convert(cid);
  console.log(url);
};

// (async () => {
//   await convertFile(
//     "bafkreihg6ug5lgxtkhhakqg6lgjopmjtncwjz6uox7ab2q3qulp5cdrx2a"
//   );
// })();

const updatKeyValue = async () => {
  const update = await pinata.files.private.update({
    id: "0197a424-e4dc-7563-b33b-26c4adbd895a", // Target File ID
    keyvalues: {
      projectId: "123",
    },
  });
};

// (async () => {
//   await updatKeyValue();
// })();
// export async function fetchVector(userQuery: string): Promise<Document[]> {
//   try {
//     const response: VectorizeQueryResponse =
//       await pinata.files.private.queryVectors({
//         groupId: GROUP_ID,
//         query: userQuery,
//         returnFile: true,
//       });

//     const documents: Document[] = [];

//     for (const match of response.matches) {
//       const { cid, score }: VectorQueryMatch = match;

//       const fileResult = await pinata.files.get({ cid });
//       const { data, contentType } = await pinata.gateways.private.get(cid);

//       const content: string =
//         contentType === "string" ? data : JSON.stringify(data);

//       documents.push(
//         new Document({
//           pageContent: JSON.stringify(data),
//           metadata: { cid, score },
//         })
//       );
//     }

//     return documents;
//   } catch (error) {
//     console.error("❌ Pinata vector fetch failed:", error);
//     return [];
//   }
// }
