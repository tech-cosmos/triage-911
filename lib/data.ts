import type { RawCall } from "./types";

// Synthetic spike: one apartment fire in Chelsea generating dozens of calls,
// with five unrelated emergencies hidden in the stream — some only ~300m away.

type Spec = [t: number, transcript: string, dNorthM: number, dEastM: number];

const ORIGINS = {
  fire: [40.74445, -73.9964], // 214 W 23rd St
  cardiac: [40.74355, -73.99965], // 8th Ave & W 21st
  crash: [40.7456, -73.99415], // 7th Ave & W 25th
  dv: [40.7462, -73.9962], // 245 W 25th St
  overdose: [40.7419, -73.988], // Madison Square Park
  fall: [40.7459, -74.0017], // 9th Ave & W 22nd
} as const;

const SPECS: Record<keyof typeof ORIGINS, Spec[]> = {
  fire: [
    [0, "There's a fire! Apartment building on West 23rd, 214 I think, smoke coming out of the fourth floor windows.", 10, 5],
    [6, "Yeah hi, I'm on 23rd street and there's a lot of black smoke coming out of a building across from me.", -40, 20],
    [11, "The building next to the Chelsea Hotel is on fire, flames on the top floors.", 25, -30],
    [15, "Fire at 214 West 23rd, I live on the second floor, we're all getting out, the hallway is full of smoke.", 0, 0],
    [19, "I can see smoke from 7th avenue, big column, somewhere around 23rd.", -20, 280],
    [22, "There's people at the windows on the fifth floor of 214 West 23rd, they're waving, they can't get down the stairs!", 5, 0],
    [26, "Fire on 23rd between 7th and 8th, uh, the red brick building.", 15, -60],
    [29, "Hi, um, I smell smoke really strong, I'm at 220 West 23rd, is it our building?", 0, -40],
    [32, "Building fire on West Twenty Third, near the hotel, please hurry.", -30, -10],
    [35, "My grandmother is in 4C at 214 West 23rd, she uses a wheelchair, she can't get out, please send someone!", 0, 5],
    [38, "Smoke everywhere on 23rd, there's ash falling on the street.", -50, 30],
    [41, "Fire in the apartment building at two fourteen west twenty third street.", 8, 2],
    [44, "I'm calling about the fire on 23rd, are you guys aware? It looks really bad.", -60, -70],
    [47, "There's a kid on the third floor fire escape at the burning building on 23rd, he's alone!", 6, 6],
    [50, "Fire near Chelsea Hotel, lots of smoke, cars stopping in the street.", 30, -50],
    [53, "214 West 23rd is on fire, I can see flames now coming out the roof.", 10, 0],
    [56, "Is somebody coming? The fire on 23rd street, it's getting bigger.", -25, 15],
    [59, "There's a building burning on West 23rd, I'm in the deli across the street.", -45, 10],
    [62, "Smoke in my apartment, I'm at 216 West 23rd, next door to the fire, should I leave?", 0, -15],
    [65, "Big fire, West 23rd, Chelsea. That's all I know, I'm on a bus going by.", -10, 120],
    [68, "Uh hi, there's a fire, 23rd street, near 8th avenue maybe? Lots of smoke.", 20, -200],
    [71, "A man just jumped from a window at the fire on 23rd, he's on the sidewalk, he's not moving!", 2, 3],
    [74, "Fire at 214 West 23rd, firefighters aren't here yet!", 10, 5],
    [77, "I'm the super at 214 West 23rd, the fire started in 4B, the sprinklers aren't working.", 0, 0],
    [80, "There's smoke coming out of a building on 23rd near 7th, black smoke.", -30, 150],
    [83, "Fire across from me on 23rd, people are standing on the street coughing.", -40, -20],
    [86, "My friend lives at 214 West 23rd, she just texted me there's a fire and she's stuck in the bathroom on the 5th floor.", 1800, 900],
    [89, "Big fire on West 23rd street, I see it from my office window on 24th.", 120, 40],
    [92, "Hello? Fire! Twenty third street! The building with the green awning!", 5, -10],
    [95, "Smoke on 23rd, it's coming into our restaurant through the vents.", -35, -45],
    [98, "Building on fire, West 23rd, flames on two floors now.", 12, 8],
    [101, "I'm calling for the fire at the Chelsea building, 23rd street, is anyone hurt?", 20, -35],
    [104, "There is a pregnant woman who came out of the burning building on 23rd, she's having trouble breathing.", -10, 0],
    [107, "Fire on 23rd street, I think it's spreading to the building next door.", 0, -45],
    [110, "There's a huge fire near the Chelsea Hotel, I'm a tourist, I don't know the address.", 30, -60],
    [113, "Smoke and fire, West 23rd between 7th and 8th avenue.", -15, 30],
    [116, "Hi I'm calling about the fire on West 23rd, the street is blocked, can ambulances get through?", -70, 60],
    [119, "Fire at 214 West 23rd, still people inside on the top floor.", 6, 4],
    [122, "Can you see the smoke from your end? 23rd and 7th, massive fire.", -20, 300],
    [125, "There's a building on fire on 23rd, my dog ran off, I'm, anyway it's burning.", -55, 5],
    [128, "Fire, west 23rd street, big flames, hurry please.", 15, 15],
    [131, "Calling about the apartment fire on 23rd, flames visible from the High Line.", 100, -400],
    [134, "Fire in Chelsea, 23rd street, the whole block smells like smoke.", -80, -30],
    [137, "There's a fire, 23rd street, an old man came out with burns on his arms.", 0, 10],
    [140, "Hi, fire at the building on west twenty-third, I already called but it's getting worse.", 10, 0],
    [143, "Smoke from a fire on 23rd is coming in my window on 22nd street, should I close it?", -150, 20],
    [146, "Fire at 214 West 23rd, roof collapsed, firefighters are pulling back.", 5, 5],
    [149, "Big fire, Chelsea, West 23rd, I see it from across the street.", -40, 0],
  ],
  cardiac: [
    [33, "My husband just collapsed, he's not breathing! We're at 8th avenue and 21st street, in the laundromat!", 0, 0],
    [40, "A man collapsed in the laundromat on 8th avenue near 21st, somebody's doing CPR.", 10, 10],
  ],
  crash: [
    [57, "A taxi just hit a cyclist at 7th avenue and 25th street, he's bleeding from his head.", 0, 0],
    [61, "Car accident, 7th and 25th, a bike rider is on the ground.", 15, -10],
    [69, "There's a cab that hit a guy on a bike on 7th avenue, around 25th, he's conscious but hurt.", -20, 10],
  ],
  dv: [
    [79, "(whispering) He's got a knife, he says he's going to kill me, 245 West 25th, apartment 3F, please.", 0, 0],
  ],
  overdose: [
    [96, "Someone's overdosing in Madison Square Park, by the dog run, he's blue, he's not responding!", 0, 0],
    [103, "There's a guy unconscious near the dog run in Madison Square Park, I think it's drugs.", 20, -15],
  ],
  fall: [
    [115, "My elderly mother fell in the kitchen, she's conscious and talking but she can't get up, 9th avenue and 22nd, 4th floor.", 0, 0],
  ],
};

const M_LAT = 1 / 111_000;
const M_LNG = 1 / 84_400; // at ~40.74°N

export const CALLS: RawCall[] = Object.entries(SPECS)
  .flatMap(([truth, specs]) =>
    specs.map(([t, transcript, dn, de]) => {
      const [lat, lng] = ORIGINS[truth as keyof typeof ORIGINS];
      return { id: "", t, transcript, lat: lat + dn * M_LAT, lng: lng + de * M_LNG, truth };
    }),
  )
  .sort((a, b) => a.t - b.t)
  .map((c, i) => ({ ...c, id: `C${String(i + 1).padStart(3, "0")}` }));

export const MAIN_EVENT = "fire";
