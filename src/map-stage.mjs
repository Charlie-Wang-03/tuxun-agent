export function useMapOnly(history, mapRect, mapImage) {
  const previous=history.at(-1)?.type;
  return Boolean(mapImage && mapRect?.width>=400 && mapRect?.height>=250 && ['hover','map_control','map_scroll','map_select','select_and_review'].includes(previous));
}

// Preserve fresh evidence for every decision. Map-only steps use the current
// map capture as both model input and replay evidence, never an old street file.
export async function captureDecisionImages({history, mapRect, mapImage, requireStreetEvidence = false, captureStreet, captureCompass}) {
  const mapOnly=useMapOnly(history,mapRect,mapImage);
  if(mapOnly&&!requireStreetEvidence)return {image:mapImage,compass:null,mapOnly};
  const image=await captureStreet(),compass=await captureCompass();
  return {image,compass,mapOnly};
}

// A hover decision describes the street visible immediately before opening the map.
export function latestStreetObservation(history) {
  return history.filter(a=>['hover','drag','scroll','move_arrow','move_road'].includes(a.type) && a.observation).at(-1)?.observation
    ?? history.find(a=>a.observation)?.observation ?? '';
}
