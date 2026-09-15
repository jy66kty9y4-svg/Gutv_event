export type LeadershipPhotoPosition =
  | 'center top'
  | 'center center'
  | 'center bottom'
  | `${number}% ${number}%`;

export type LeadershipPerson = {
  id: number;
  name: string;
  description: string;
  photoUrl: string;
  photoPosition: LeadershipPhotoPosition;
  photoScale: number;
};

export type LeadershipPosition = {
  id: number;
  title: string;
  sortOrder: number;
  personId: number | null;
};

export type LeadershipRoster = {
  positions: LeadershipPosition[];
  people: LeadershipPerson[];
};

export type PublicLeadershipCard = LeadershipPosition & {
  person: LeadershipPerson | null;
};
