"""
Urbanist category and status rules for DC 311 service requests.

Categories are embedded into manifest.json at build time by dashboard/scripts/build_data.py.
The browser reads from the manifest at runtime; nothing here is duplicated in TypeScript.
"""

WARD_ORDER = [f"Ward {i}" for i in range(1, 9)]

EXCLUDED_SERVICE_TYPES = {
    "Test",
    "Sample SR",
}

PARKING_TYPES = {
    "Parking Enforcement",
    "Residential Parking Permit Violation",
    "Out of State Parking Violation (ROSA)",
    "Abandoned Vehicle - On Public Property",
    "Abandoned Vehicle - On Private Property",
    "Emergency No-Parking Verification",
    "Parking Meter Repair",
}

PEDESTRIAN_INFRA_TYPES = {
    "Sidewalk Repair",
    "Streetlight Repair Investigation",
}

SNOW_WINTER_TYPES = {
    "Snow and Ice Removal on Public Space",
    "Residential Snow Hero (ServeDC)",
    "Residential Snow Removal (ServeDC)",
    "Snow Removal Complaints for Sidewalks",
    "Snow Sidewalk Shoveling Enforcement Exemption",
}

ROADS_TYPES = {
    "Pothole",
    "Roadway Repair",
    "Alley Repair",
}

TRAFFIC_SAFETY_TYPES = {
    "Traffic Lights and Pedestrian Walk Signals",
    "Traffic Signal Issue",
    "Roadway Signs",
    "Roadway Markings / Pylons",
    "Roadway Striping / Markings",
    "Traffic Safety Input",
}

CYCLING_TYPES = {
    "Bicycle Services",
    "Dockless Vehicle Parking Complaint",
    "Abandoned Bicycle",
}

TRANSIT_TYPES = {
    "Bus Stop Issues",
    "Bus and Streetcar Issues",
    "Bus/Rail Issues",
}

SANITATION_TYPES = {
    "Illegal Dumping",
    "Trash Collection - Missed",
    "Sanitation Enforcement",
    "Alley Cleaning",
    "Street Cleaning",
    "Public Space Litter Can-Collection",
    "Public Space Litter Can Repair",
    "Public Space Litter Can Installation",
    "Public Space Litter Can Removal",
    "Graffiti Removal",
    "Dead Animal Collection",
    "Pet Waste Complaint",
    "DGS - Overflowing Recycling Can",
    "Signed Street Sweeping Missed",
}

WASTE_TYPES = {
    "Bulk Collection",
    "Scheduled Yard Waste",
    "Leaf  Collection Missed",
    "Recycling Collection - Missed",
    "Missed Curbside Compost Collection",
    "Container Removal",
    "Supercan - Delivery",
    "Supercan - Repair",
    "Trash Cart - Delivery",
    "Trash Cart Repair",
    "Recycling Cart Delivery",
    "Recycling Cart - Repair",
    "Recycling- Information Request",
    "Recycling - Commercial Only",
    "Christmas Tree Removal - Missed",
    "Lost/Stolen Compost Bin, Broken Compost Bin or Opt-Out of Curbside Composting Pilot Program",
    "Recycling - School Program",
}

TREE_TYPES = {
    "Tree Inspection",
    "Tree Pruning",
    "Tree Planting",
    "Tree Removal",
    "Tree Inspection - Tree Down",
}

RODENT_TYPES = {
    "Rodent Inspection and Treatment",
    "DC Health Rodent & Vector Control",
    "Rat Replacement Containers",
}

PUBLIC_SPACE_TYPES = {
    "Public Space Inspection",
    "Illegal Poster",
    "Vacant Lot - Public Property Only",
    "DGS - Playground Repair",
    "DGS Grounds Landscaping (DGS)",
    "DC Dog Park Maintenance (DGS)",
    "DC Spray Parks (DGS)",
    "DC Indoor and Outdoor Pool Maintenance  (DGS)",
    "Grass and Weeds Mowing",
    "Grass Mowing Services Missed (DGS)",
    "Neighborhood Clean-Up",
}

BUILDINGS_SAFETY_TYPES = {
    "DOB - Vacant Private Property Inspection",
    "DOB - Illegal Construction",
    "FEMS - Smoke Alarm Application",
    "FEMS - Fire Safety Inspection",
    "FEMS - Fire Safety Education",
    "FEMS - Community Events",
    "Emergency - Power Outage/Wires Down",
    "Wire Down/Power Outage",
    "Emergency - Heating and Cooling",
    "Emergency - Flooding",
    "Illegal Fireworks",
    "OCTFME - Down Cable Wires",
    "DC Water - Customer Flooding",
    "Bee Treatment and Inspection (DOH)",
}

ENVIRONMENT_TYPES = {
    "DOEE - General Air Quality Concerns",
    "DOEE - Report Construction Erosion Runoff",
    "DOEE - Engine Idling Tips",
    "DOEE - Foam Ban / Food Service Ware Requirements",
    "DOEE - Bag Law Tips",
    "DPW - Reporting Electronics in Trash",
    "Green Infrastructure Maintenance",
}

DMV_TYPES = {
    "DMV - Drivers License/ID Issues",
    "DMV - Vehicle Registration Issues",
    "DMV - Ticket Payment Dispute",
    "DMV - Online Processing Issues",
    "DMV - Forms, Applications, and Manuals Request",
    "DMV - Copy of Ticket",
    "DMV - Vehicle Title Issues",
    "DMV - Driver and Vehicle Services Refund",
    "DMV - Hearings",
    "DMV - Refunds - Tickets",
    "DMV - Vehicle Insurance Lapse",
    "DMV - Vehicle Inspection Issues",
    "DMV - Drivers License/ID Reinstatement",
    "DMV - Appeal",
    "DMV - eTIMS Ticket Alert Services Issues",
    "DMV - Driver Record Issues",
    "DMV - Ticket Ombudsman",
    "DMV - Processing Center Manager",
    "DMV - ATEquity Pilot",
    "DMV - Adjudication Supervisor",
    "Ticket Ombudsman",
    "DC How Am I Driving?",
    "Resident Parking Permit",
    "DFHV - For Hire Vehicle Concerns",
    "DFHV - Lost and Found Claims (DC Taxi)",
}

CITY_SERVICES_TYPES = {
    "DC Government Information",
    "311Force Reported Issues",
    "Hypothermia Shelter Information",
    "DMOI Customer Service Tracker",
}

CATEGORY_MAP = {
    **{t: "Pedestrian Infrastructure" for t in PEDESTRIAN_INFRA_TYPES},
    **{t: "Roads & Vehicle Infrastructure" for t in ROADS_TYPES},
    **{t: "Traffic Safety" for t in TRAFFIC_SAFETY_TYPES},
    **{t: "Cycling & Micromobility" for t in CYCLING_TYPES},
    **{t: "Transit" for t in TRANSIT_TYPES},
    **{t: "Sanitation & Dumping" for t in SANITATION_TYPES},
    **{t: "Waste & Recycling" for t in WASTE_TYPES},
    **{t: "Parking & Vehicles" for t in PARKING_TYPES},
    **{t: "Trees & Canopy" for t in TREE_TYPES},
    **{t: "Rodent Control" for t in RODENT_TYPES},
    **{t: "Public Space & Parks" for t in PUBLIC_SPACE_TYPES},
    **{t: "Buildings & Safety" for t in BUILDINGS_SAFETY_TYPES},
    **{t: "Environment" for t in ENVIRONMENT_TYPES},
    **{t: "Snow & Winter" for t in SNOW_WINTER_TYPES},
    **{t: "DMV & Vehicles" for t in DMV_TYPES},
    **{t: "City Services & Info" for t in CITY_SERVICES_TYPES},
}

OPEN_STATUSES = {"Open", "In-Progress", "In Progress"}
# Any status with the "Closed" prefix is considered closed; this set is the
# canonical list of values seen in the source data, used for reference only.
CLOSED_STATUSES = {"Closed", "Closed (Duplicate)", "Closed (Transferred)"}


def is_excluded_service_type(desc: str) -> bool:
    return desc in EXCLUDED_SERVICE_TYPES


def assign_category(desc: str) -> str:
    return CATEGORY_MAP.get(desc, "Other")
