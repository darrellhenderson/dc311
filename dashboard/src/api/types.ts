export interface ServiceRequest {
  SERVICEREQUESTID: string;
  ADDDATE: string;
  RESOLUTIONDATE: string | null;
  SERVICEDUEDATE: string | null;
  SERVICEORDERDATE: string | null;
  INSPECTIONDATE: string | null;
  CREATED: string | null;
  EDITED: string | null;
  SERVICECODE: number;
  SERVICECODEDESCRIPTION: string;
  SERVICETYPECODEDESCRIPTION: string | null;
  ORGANIZATIONACRONYM: string | null;
  SERVICEORDERSTATUS: string;
  STATUS_CODE: string | null;
  PRIORITY: number | null;
  SERVICECALLCOUNT: number | null;
  INSPECTIONFLAG: string | null;
  INSPECTORNAME: string | null;
  STREETADDRESS: string | null;
  CITY: string | null;
  STATE: string | null;
  ZIPCODE: string | null;
  DETAILS: string | null;
  WARD: string;
  LATITUDE: number | null;
  LONGITUDE: number | null;
}
