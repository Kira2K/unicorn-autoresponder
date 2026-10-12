export type DirectoryCompany = {
  key:string; name:string; existingId?:string; expectedExistingName?:string;
  comment:string; markets:string[]; tags:string[]; languages:string[]; aliases:string[];
  contacts:{type:string;value:string}[]; applicationRoute:'standard_workflow'|'notify_only';
  provenance:Record<string,unknown>;
};
export type DirectorySource = {
  key:string; companyKey:string|null; name:string; type:'website'|'aggregator'|'tg-channel'|'linkedin';
  url:string; disposition:'enabled'|'blocked_linkedin'|'superseded'; comment:string;
  provenance:Record<string,unknown>;
};
export type DirectorySnapshot = {
  version:1; source:{fileId:string;capturedAt:string;workbookSha256:string};
  companies:DirectoryCompany[]; sources:DirectorySource[];
};
