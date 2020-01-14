/**
 * Copyright 2016-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
Search provider interface:
--------------------------

  onSearch: function(text, requestId, searchOptions, dispatch, state) {
      let results = [ ... ]; // See below
      return addSearchResults({data: results, provider: providerId, reqId: requestId}, true);
      // or
      return dispatch( (...) => {
        return addSearchResults({data: results, provider: providerId, reqId: requestId}, true);
    });
  }

  getResultGeometry: function(resultItem, callback) {
    // ...
    callback(resultItem, geometryWktString);
  }

  getMoreResults: function(moreItem, text, requestId, dispatch) {
    // Same return object as onSearch
  }


Format of search results:
-------------------------

  results = [
    {
        id: categoryid,                     // Unique category ID
        title: display_title,               // Text to display as group title in the search results
        priority: priority_nr,              // Optional search result group priority. Groups with higher priority are displayed first in the list.
        items: [
            {                                 // Location search result:
                type: SearchResultType.PLACE,   // Specifies that this is a location search result
                id: itemid,                     // Unique item ID
                text: display_text,             // Text to display as search result
                label: map_label_text,          // Optional, text to show next to the position marker on the map instead of <text>
                x: x,                           // X coordinate of result
                y: y,                           // Y coordinate of result
                crs: crs,                       // CRS of result coordinates and bbox
                bbox: [xmin, ymin, xmax, ymax], // Bounding box of result (if non-empty, map will zoom to this extent when selecting result)
                provider: providerid            // The ID of the provider which generated this result. Required if `getResultGeometry` is to be called.
            },
            {                                   // Theme layer search result (advanced):
                type: SearchResultType.THEMELAYER, // Specifies that this is a theme layer search result
                id: itemid,                        // Unique item ID
                text: display_text,                // Text to display as search result
                layer: {<Layer definition>}        // Layer definition, in the same format as a "sublayers" entry in themes.json.
            },
            {                        // Optional entry to request more results:
                id: itemid,            // Unique item ID
                more: true,            // Specifies that this entry is a "More..." entry
                provider: providerid   // The ID of the provider which generated this result.
            }
        ]
    },
    {
        ...
    }
  ]

*/

import axios from 'axios';
import {addSearchResults, SearchResultType} from "qwc2/actions/search";
import CoordinatesUtils from 'qwc2/utils/CoordinatesUtils';

function coordinatesSearch(text, requestId, searchOptions, dispatch) {
    const displaycrs = searchOptions.displaycrs || "EPSG:4326";
    const matches = text.match(/^\s*([+-]?\d+\.?\d*)[,\s]\s*([+-]?\d+\.?\d*)\s*$/);
    const items = [];
    if (matches && matches.length >= 3) {
        const x = parseFloat(matches[1]);
        const y = parseFloat(matches[2]);
        if (displaycrs !== "EPSG:4326") {
            items.push({
                id: "coord0",
                text: x + ", " + y + " (" + displaycrs + ")",
                x: x,
                y: y,
                crs: displaycrs,
                bbox: [x, y, x, y]
            });
        }
        if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
            const title = Math.abs(x) + (x >= 0 ? "°E" : "°W") + ", "
                      + Math.abs(y) + (y >= 0 ? "°N" : "°S");
            items.push({
                id: "coord" + items.length,
                text: title,
                x: x,
                y: y,
                crs: "EPSG:4326",
                bbox: [x, y, x, y]
            });
        }
        if (x >= -90 && x <= 90 && y >= -180 && y <= 180 && x !== y) {
            const title = Math.abs(y) + (y >= 0 ? "°E" : "°W") + ", "
                      + Math.abs(x) + (x >= 0 ? "°N" : "°S");
            items.push({
                id: "coord" + items.length,
                text: title,
                x: y,
                y: x,
                crs: "EPSG:4326",
                bbox: [y, x, y, x]
            });
        }
    }
    const results = [];
    if (items.length > 0) {
        results.push(
            {
                id: "coords",
                titlemsgid: "search.coordinates",
                items: items
            }
        );
    }
    dispatch(addSearchResults({data: results, provider: "coordinates", reqId: requestId}, true));
}

/** ************************************************************************ **/

function geoAdminLocationSearch(text, requestId, searchOptions, dispatch) {
    axios.get("http://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=" + encodeURIComponent(text) + "&type=locations&limit=20")
        .then(response => dispatch(geoAdminLocationSearchResults(response.data, requestId)));
}

function parseItemBBox(bboxstr) {
    if (bboxstr === undefined) {
        return null;
    }
    const matches = bboxstr.match(/^BOX\s*\(\s*(\d+\.?\d*)\s*(\d+\.?\d*)\s*,\s*(\d+\.?\d*)\s*(\d+\.?\d*)\s*\)$/);
    if (matches && matches.length < 5) {
        return null;
    }
    const xmin = parseFloat(matches[1]);
    const ymin = parseFloat(matches[2]);
    const xmax = parseFloat(matches[3]);
    const ymax = parseFloat(matches[4]);
    return CoordinatesUtils.reprojectBbox([xmin, ymin, xmax, ymax], "EPSG:21781", "EPSG:4326");
}

function geoAdminLocationSearchResults(obj, requestId) {
    const categoryMap = {
        gg25: "Municipalities",
        kantone: "Cantons",
        district: "Districts",
        sn25: "Places",
        zipcode: "Zip Codes",
        address: "Address",
        gazetteer: "General place name directory"
    };
    const resultGroups = {};
    (obj.results || []).map(entry => {
        if (resultGroups[entry.attrs.origin] === undefined) {
            resultGroups[entry.attrs.origin] = {
                id: entry.attrs.origin,
                title: categoryMap[entry.attrs.origin] || entry.attrs.origin,
                items: []
            };
        }
        const x = entry.attrs.lon;
        const y = entry.attrs.lat;
        resultGroups[entry.attrs.origin].items.push({
            id: entry.id,
            text: entry.attrs.label,
            x: x,
            y: y,
            crs: "EPSG:4326",
            bbox: parseItemBBox(entry.attrs.geom_st_box2d) || [x, y, x, y],
            provider: "geoadmin"
        });
    });
    const results = Object.values(resultGroups);
    return addSearchResults({data: results, provider: "geoadmin", reqId: requestId}, true);
}

/** ************************************************************************ **/

function usterSearch(text, requestId, searchOptions, dispatch) {
    axios.get("https://webgis.uster.ch/wsgi/search.wsgi?&searchtables=&query=" + encodeURIComponent(text))
        .then(response => dispatch(usterSearchResults(response.data, requestId)));
}

function usterSearchResults(obj, requestId) {
    const results = [];
    let currentgroup = null;
    let groupcounter = 0;
    let counter = 0;
    (obj.results || []).map(entry => {
        if (!entry.bbox) {
            // Is group
            currentgroup = {
                id: "ustergroup" + (groupcounter++),
                title: entry.displaytext,
                items: []
            };
            results.push(currentgroup);
        } else if (currentgroup) {
            currentgroup.items.push({
                id: "usterresult" + (counter++),
                text: entry.displaytext,
                searchtable: entry.searchtable,
                bbox: entry.bbox.slice(0),
                x: 0.5 * (entry.bbox[0] + entry.bbox[2]),
                y: 0.5 * (entry.bbox[1] + entry.bbox[3]),
                crs: "EPSG:21781",
                provider: "uster"
            });
        }
    });
    return addSearchResults({data: results, provider: "uster", reqId: requestId}, true);
}

function usterResultGeometry(resultItem, callback) {
    axios.get("https://webgis.uster.ch/wsgi/getSearchGeom.wsgi?searchtable=" + encodeURIComponent(resultItem.searchtable) + "&displaytext=" + encodeURIComponent(resultItem.text))
        .then(response => callback(resultItem, response.data, "EPSG:21781"));
}

/** ************************************************************************ **/

function wolfsburgSearch(text, requestId, searchOptions, dispatch) {
    axios.get("https://geoportal.stadt.wolfsburg.de/wsgi/search.wsgi", {params: {
        query: text,
        searchTables: '["Infrastruktur", "Stadt- und Ortsteile"]',
        searchFilters: '["Abfallwirtschaft,Haltestellen,Hilfsorganisationen", ""]',
        searchArea: "Wolfsburg",
        searchCenter: "",
        searchRadius: "",
        topic: "stadtplan",
        resultLimit: 100,
        resultLimitCategory: 100
    }}).then(response => dispatch(wolfsburgSearchResults(response.data, requestId)));
}

function wolfsburgSearchResults(obj, requestId) {
    const results = [];
    let currentgroup = null;
    let groupcounter = 0;
    let counter = 0;
    (obj.results || []).map(entry => {
        if (!entry.bbox) {
            // Is group
            currentgroup = {
                id: "wolfsburggroup" + (groupcounter++),
                title: entry.displaytext,
                items: []
            };
            results.push(currentgroup);
        } else if (currentgroup) {
            currentgroup.items.push({
                id: "wolfsburgresult" + (counter++),
                text: entry.displaytext,
                searchtable: entry.searchtable,
                oid: entry.id,
                bbox: entry.bbox.slice(0),
                x: 0.5 * (entry.bbox[0] + entry.bbox[2]),
                y: 0.5 * (entry.bbox[1] + entry.bbox[3]),
                crs: "EPSG:25832",
                provider: "wolfsburg"
            });
        }
    });
    return addSearchResults({data: results, provider: "wolfsburg", reqId: requestId}, true);
}

function wolfsburgResultGeometry(resultItem, callback) {
    axios.get("https://geoportal.stadt.wolfsburg.de/wsgi/getSearchGeom.wsgi", {params: {
        searchtable: resultItem.searchtable,
        id: resultItem.oid
    }}).then(response => callback(resultItem, response.data, "EPSG:25832"));
}

/** ************************************************************************ **/

function glarusSearch(text, requestId, searchOptions, dispatch) {
    const limit = 9;
    axios.get("https://map.geo.gl.ch/search/all?limit=" + limit + "&query=" + encodeURIComponent(text))
        .then(response => dispatch(glarusSearchResults(response.data, requestId, limit)))
        .catch(() => dispatch(glarusSearchResults({}, requestId, limit)));
}

function glarusMoreResults(moreItem, text, requestId, dispatch) {
    axios.get("https://map.geo.gl.ch/search/" + moreItem.category + "?query=" + encodeURIComponent(text))
        .then(response => dispatch(glarusSearchResults(response.data, requestId)))
        .catch(() => dispatch(glarusSearchResults({}, requestId)));
}

function glarusSearchResults(obj, requestId, limit = -1) {
    const results = [];
    let idcounter = 0;
    (obj.results || []).map(group => {
        const groupResult = {
            id: group.category,
            title: group.name,
            items: group.features.map(item => {
                return {
                    id: item.id,
                    text: item.name,
                    bbox: item.bbox.slice(0),
                    x: 0.5 * (item.bbox[0] + item.bbox[2]),
                    y: 0.5 * (item.bbox[1] + item.bbox[3]),
                    crs: "EPSG:2056",
                    provider: "glarus",
                    category: group.category
                };
            })
        };
        if (limit >= 0 && group.features.length > limit) {
            groupResult.items.push({
                id: "glarusmore" + (idcounter++),
                more: true,
                provider: "glarus",
                category: group.category
            });
        }
        results.push(groupResult);
    });
    return addSearchResults({data: results, provider: "glarus", reqId: requestId}, true);
}

function glarusResultGeometry(resultItem, callback) {
    axios.get("https://map.geo.gl.ch/search/" + resultItem.category + "/geometry?id=" + resultItem.id)
        .then(response => callback(resultItem, response.data, "EPSG:2056"));
}

/** ************************************************************************ **/

function nominatimSearchResults(obj, requestId) {
    const results = [];
    const groups = {};
    let groupcounter = 0;

    (obj || []).map(entry => {
        if (!(entry.class in groups)) {
            groups[entry.class] = {
                id: "nominatimgroup" + (groupcounter++),
                // capitalize class
                title: entry.class.charAt(0).toUpperCase() + entry.class.slice(1),
                items: []
            };
            results.push(groups[entry.class]);
        }

        // shorten display_name
        let text = entry.display_name.split(', ').slice(0, 3).join(', ');
        // map label
        const label = text;

        // collect address fields
        const address = [];
        if (entry.address.town) {
            address.push(entry.address.town);
        }
        if (entry.address.city) {
            address.push(entry.address.city);
        }
        if (entry.address.state) {
            address.push(entry.address.state);
        }
        if (entry.address.country) {
            address.push(entry.address.country);
        }
        if (address.length > 0) {
            text += "<br/><i>" + address.join(', ') + "</i>";
        }

        // reorder coords from [miny, maxy, minx, maxx] to [minx, miny, maxx, maxy]
        const b = entry.boundingbox.map(coord => parseFloat(coord));
        const bbox = [b[2], b[0], b[3], b[1]];

        groups[entry.class].items.push({
            id: entry.place_id,
            // shorten display_name
            text: text,
            label: label,
            bbox: bbox,
            x: 0.5 * (bbox[0] + bbox[2]),
            y: 0.5 * (bbox[1] + bbox[3]),
            crs: "EPSG:4326",
            provider: "nominatim"
        });
    });
    return addSearchResults({data: results, provider: "nominatim", reqId: requestId}, true);
}

function nominatimSearch(text, requestId, searchOptions, dispatch) {
    axios.get("//nominatim.openstreetmap.org/search", {params: {
        q: text,
        addressdetails: 1,
        limit: 20,
        format: 'json'
    }}).then(response => dispatch(nominatimSearchResults(response.data, requestId)));
}

/** ************************************************************************ **/

function parametrizedSearch(cfg, text, requestId, searchOptions, dispatch) {
    const SEARCH_URL = ""; // ...
    axios.get(SEARCH_URL + "?param=" + cfg.param + "&searchtext=" + encodeURIComponent(text))
        .then(response => dispatch(addSearchResults({data: response.data, provider: cfg.key, reqId: requestId})))
        .catch(() => dispatch(addSearchResults({data: [], provider: cfg.key, reqId: requestId})));
}

/** ************************************************************************ **/

function createLayerSearchResult(sublayers, title = 'Layers') {
    const result = { id: 'layers', title };

    if (Array.isArray(sublayers)) {
        result.items = sublayers.map(function(sublayer) {
            return {
                type: SearchResultType.THEMELAYER,
                id: sublayer.name.toLowerCase(),
                text: sublayer.name,
                layer: { sublayers: [sublayer] }
            };
        });
    } else {
        result.items = [
            {
                type: SearchResultType.THEMELAYER,
                id: sublayers.name.toLowerCase(),
                text: sublayers.name,
                layer: { sublayers: [sublayers] }
            }
        ];
    }

    return result;
}

function createLayerSearchSublayers(boundingBoxes, type) {
    return boundingBoxes.map(function(bounds, index) {
        const i = index + 1;
        const name = `${type}${i < 10 ? `0${i}` : i}`;

        return {
            name,
            title: name,
            visibility: true,
            queryable: true,
            displayField: 'LUNGHEZZA',
            opacity: 255,
            bbox: { crs: 'EPSG:4326', bounds }
        };
    });
}

function layerSearch(text, requestId, searchOptions, dispatch) {
    const bigRingTrails = [
        [13.084399, 42.93018, 13.225101, 43.057469],
        [13.112396, 42.987247, 13.156464, 43.034649],
        [13.154203, 42.887885, 13.314918, 43.065831],
        [13.219384, 42.888912, 13.314918, 43.065831],
        [13.294092, 42.928977, 13.317705, 42.985975],
        [13.299054, 42.842795, 13.325479, 42.929384],
        [13.206974, 42.756025, 13.309859, 42.843539],
        [13.100696, 42.754517, 13.209451, 42.855694],
        [13.079614, 42.853673, 13.103259, 42.930391]
    ];

    const bikingTrails = [
        [13.080975, 43.060759, 13.145188, 43.100081],
        [13.159368, 43.056278, 13.253595, 43.101067],
        [13.226789, 43.0474, 13.268515, 43.077059],
        [13.139385, 42.951842, 13.242815, 43.042751],
        [13.284902, 42.942894, 13.357075, 42.998809],
        [13.285922, 42.909734, 13.346104, 42.946046],
        [13.298747, 42.849369, 13.340322, 42.90578],
        [13.300898, 42.809218, 13.342393, 42.842008],
        [13.270826, 42.771548, 13.329335, 42.813392],
        [13.180091, 42.764877, 13.235432, 42.840299],
        [13.092829, 42.727978, 13.155233, 42.792826],
        [13.032941, 42.832141, 13.113966, 42.882266],
        [13.086874, 42.848953, 13.156465, 42.930494],
        [13.130815, 42.934986, 13.201009, 42.952252],
        [13.084882, 42.930839, 13.173372, 43.036227],
        [13.154752, 42.965946, 13.356408, 43.044449],
        [13.303301, 42.843753, 13.349163, 42.970991],
        [13.103285, 42.747099, 13.312094, 42.844293],
        [13.053018, 42.78735, 13.121669, 42.931462],
        [13.088288, 42.931008, 13.357308, 42.990144]
    ];

    const hikingTrails = [
        [13.202855, 43.079994, 13.229677, 43.103703],
        [13.180711, 43.060704, 13.232776, 43.078002],
        [13.205637, 42.994688, 13.226363, 43.008354],
        [13.20152, 42.980893, 13.231547, 42.994714],
        [13.207687, 42.952431, 13.236698, 42.988956],
        [13.215823, 42.950362, 13.291272, 42.970564],
        [13.09116, 42.937774, 13.134399, 42.975608],
        [13.165058, 42.909019, 13.202166, 42.934866],
        [13.183596, 42.904182, 13.312656, 42.931485],
        [13.248974, 42.895205, 13.291616, 42.913963],
        [13.154204, 42.844375, 13.190249, 42.886117],
        [13.033476, 42.872574, 13.080433, 42.904454],
        [13.156245, 42.774004, 13.207173, 42.82914],
        [13.116651, 42.812346, 13.158333, 42.832541],
        [13.256516, 42.789967, 13.302878, 42.851929],
        [13.255466, 42.770283, 13.297133, 42.795152],
        [13.212138, 42.826894, 13.270632, 42.888353]
    ];

    const natureTrails = [
        [13.078424, 42.930684, 13.093048, 42.944983],
        [13.099838, 43.062975, 13.116469, 43.073842],
        [13.148219, 43.03512, 13.168228, 43.059598],
        [13.29151, 42.972002, 13.307532, 42.986422],
        [13.298055, 42.913438, 13.31464, 42.931517],
        [13.317468, 42.898912, 13.327444, 42.908303],
        [13.307354, 42.837146, 13.322216, 42.843607],
        [13.27301, 42.771341, 13.297367, 42.781444],
        [13.091601, 42.791864, 13.108412, 42.807232],
        [13.036099, 42.880348, 13.04361, 42.893419],
        [13.152109, 42.878041, 13.161086, 42.886974],
        [13.139205, 42.935119, 13.158339, 42.943879],
        [13.160321, 43.020402, 13.170981, 43.02849],
        [13.216583, 42.993255, 13.228745, 43.004025],
        [13.242159, 43.046231, 13.248458, 43.050647],
        [13.220142, 43.09214, 13.225891, 43.103649]
    ];

    const bigRingSublayers = createLayerSearchSublayers(bigRingTrails, 'G');
    const bikingSublayers = createLayerSearchSublayers(bikingTrails, 'B');
    const hikingSublayers = createLayerSearchSublayers(hikingTrails, 'E');
    const natureSublayers = [
        ...createLayerSearchSublayers(natureTrails, 'N'),
        {
            name: 'N17_1',
            title: 'N17_1',
            visibility: true,
            queryable: true,
            displayField: 'LUNGHEZZA',
            opacity: 255,
            bbox: {
                crs: 'EPSG:4326',
                bounds: [13.16521, 43.03974, 13.169361, 43.044502]
            }
        },
        {
            name: 'N18_2',
            title: 'N18_2',
            visibility: true,
            queryable: true,
            displayField: 'LUNGHEZZA',
            opacity: 255,
            bbox: {
                crs: 'EPSG:4326',
                bounds: [13.247802, 42.76405, 13.260019, 42.785179]
            }
        }
    ];

    const results = [];

    if (text === 'B' || text === 'b') {
        results.push(createLayerSearchResult(bikingSublayers));
    } else if (text === 'B0' || text === 'b0') {
        results.push(createLayerSearchResult(bikingSublayers.slice(0, 9)));
    } else if (text === 'B1' || text === 'b1') {
        results.push(
            createLayerSearchResult([
                bikingSublayers[0],
                ...bikingSublayers.slice(9, 19)
            ])
        );
    } else if (text === 'B2' || text === 'b2') {
        results.push(
            createLayerSearchResult([bikingSublayers[1], bikingSublayers[19]])
        );
    } else if (text === 'B01' || text === 'b01') {
        results.push(createLayerSearchResult(bikingSublayers[0]));
    } else if (text === 'B02' || text === 'b02') {
        results.push(createLayerSearchResult(bikingSublayers[1]));
    } else if (
        text === 'B3' ||
        text === 'B03' ||
        text === 'b3' ||
        text === 'b03'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[2]));
    } else if (
        text === 'B4' ||
        text === 'B04' ||
        text === 'b4' ||
        text === 'b04'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[3]));
    } else if (
        text === 'B5' ||
        text === 'B05' ||
        text === 'b5' ||
        text === 'b05'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[4]));
    } else if (
        text === 'B6' ||
        text === 'B06' ||
        text === 'b6' ||
        text === 'b06'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[5]));
    } else if (
        text === 'B7' ||
        text === 'B07' ||
        text === 'b7' ||
        text === 'b07'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[6]));
    } else if (
        text === 'B8' ||
        text === 'B08' ||
        text === 'b8' ||
        text === 'b08'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[7]));
    } else if (
        text === 'B9' ||
        text === 'B09' ||
        text === 'b9' ||
        text === 'b09'
    ) {
        results.push(createLayerSearchResult(bikingSublayers[8]));
    } else if (text === 'B10' || text === 'b10') {
        results.push(createLayerSearchResult(bikingSublayers[9]));
    } else if (text === 'B11' || text === 'b11') {
        results.push(createLayerSearchResult(bikingSublayers[10]));
    } else if (text === 'B12' || text === 'b12') {
        results.push(createLayerSearchResult(bikingSublayers[11]));
    } else if (text === 'B13' || text === 'b13') {
        results.push(createLayerSearchResult(bikingSublayers[12]));
    } else if (text === 'B14' || text === 'b14') {
        results.push(createLayerSearchResult(bikingSublayers[13]));
    } else if (text === 'B15' || text === 'b15') {
        results.push(createLayerSearchResult(bikingSublayers[14]));
    } else if (text === 'B16' || text === 'b16') {
        results.push(createLayerSearchResult(bikingSublayers[15]));
    } else if (text === 'B17' || text === 'b17') {
        results.push(createLayerSearchResult(bikingSublayers[16]));
    } else if (text === 'B18' || text === 'b18') {
        results.push(createLayerSearchResult(bikingSublayers[17]));
    } else if (text === 'B19' || text === 'b19') {
        results.push(createLayerSearchResult(bikingSublayers[18]));
    } else if (text === 'B20' || text === 'b20') {
        results.push(createLayerSearchResult(bikingSublayers[19]));
    } else if (text === 'E' || text === 'e') {
        results.push(createLayerSearchResult(hikingSublayers));
    } else if (text === 'E0' || text === 'e0') {
        results.push(createLayerSearchResult(hikingSublayers.slice(0, 9)));
    } else if (text === 'E1' || text === 'e1') {
        results.push(
            createLayerSearchResult([
                hikingSublayers[0],
                ...hikingSublayers.slice(9)
            ])
        );
    } else if (text === 'E01' || text === 'e01') {
        results.push(createLayerSearchResult(hikingSublayers[0]));
    } else if (
        text === 'E2' ||
        text === 'E02' ||
        text === 'e2' ||
        text === 'e02'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[1]));
    } else if (
        text === 'E3' ||
        text === 'E03' ||
        text === 'e3' ||
        text === 'e03'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[2]));
    } else if (
        text === 'E4' ||
        text === 'E04' ||
        text === 'e4' ||
        text === 'e04'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[3]));
    } else if (
        text === 'E5' ||
        text === 'E05' ||
        text === 'e5' ||
        text === 'e05'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[4]));
    } else if (
        text === 'E6' ||
        text === 'E06' ||
        text === 'e6' ||
        text === 'e06'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[5]));
    } else if (
        text === 'E7' ||
        text === 'E07' ||
        text === 'e7' ||
        text === 'e07'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[6]));
    } else if (
        text === 'E8' ||
        text === 'E08' ||
        text === 'e8' ||
        text === 'e08'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[7]));
    } else if (
        text === 'E9' ||
        text === 'E09' ||
        text === 'e9' ||
        text === 'e09'
    ) {
        results.push(createLayerSearchResult(hikingSublayers[8]));
    } else if (text === 'E10' || text === 'e10') {
        results.push(createLayerSearchResult(hikingSublayers[9]));
    } else if (text === 'E11' || text === 'e11') {
        results.push(createLayerSearchResult(hikingSublayers[10]));
    } else if (text === 'E12' || text === 'e12') {
        results.push(createLayerSearchResult(hikingSublayers[11]));
    } else if (text === 'E13' || text === 'e13') {
        results.push(createLayerSearchResult(hikingSublayers[12]));
    } else if (text === 'E14' || text === 'e14') {
        results.push(createLayerSearchResult(hikingSublayers[13]));
    } else if (text === 'E15' || text === 'e15') {
        results.push(createLayerSearchResult(hikingSublayers[14]));
    } else if (text === 'E16' || text === 'e16') {
        results.push(createLayerSearchResult(hikingSublayers[15]));
    } else if (text === 'E17' || text === 'e17') {
        results.push(createLayerSearchResult(hikingSublayers[16]));
    } else if (
        text === 'G' ||
        text === 'G0' ||
        text === 'g' ||
        text === 'g0'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers));
    } else if (
        text === 'G1' ||
        text === 'G01' ||
        text === 'g1' ||
        text === 'g01'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[0]));
    } else if (
        text === 'G2' ||
        text === 'G02' ||
        text === 'g2' ||
        text === 'g02'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[1]));
    } else if (
        text === 'G3' ||
        text === 'G03' ||
        text === 'g3' ||
        text === 'g03'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[2]));
    } else if (
        text === 'G4' ||
        text === 'G04' ||
        text === 'g4' ||
        text === 'g04'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[3]));
    } else if (
        text === 'G5' ||
        text === 'G05' ||
        text === 'g5' ||
        text === 'g05'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[4]));
    } else if (
        text === 'G6' ||
        text === 'G06' ||
        text === 'g6' ||
        text === 'g06'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[5]));
    } else if (
        text === 'G7' ||
        text === 'G07' ||
        text === 'g7' ||
        text === 'g07'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[6]));
    } else if (
        text === 'G8' ||
        text === 'G08' ||
        text === 'g8' ||
        text === 'g08'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[7]));
    } else if (
        text === 'G9' ||
        text === 'G09' ||
        text === 'g9' ||
        text === 'g09'
    ) {
        results.push(createLayerSearchResult(bigRingSublayers[8]));
    } else if (/^gab$/i.test(text)) {
        const result = createLayerSearchResult({
            name: 'GAB',
            title: 'GAB',
            visibility: true,
            queryable: true,
            displayField: 'LUNGHEZZA',
            opacity: 255,
            bbox: {
                crs: 'EPSG:4326',
                bounds: [13.049564, 42.746306, 13.362181, 43.044449]
            }
        });

        results.push(result);
    } else if (/^gas$/i.test(text)) {
        const result = createLayerSearchResult({
            name: 'GAS',
            title: 'GAS',
            visibility: true,
            queryable: true,
            displayField: 'ET_ID',
            opacity: 255,
            bbox: {
                crs: 'EPSG:4326',
                bounds: [13.075322, 42.754668, 13.327618, 43.066628]
            }
        });

        results.push(result);
    } else if (text === 'N' || text === 'n') {
        results.push(createLayerSearchResult(natureSublayers));
    } else if (text === 'N0' || text === 'n0') {
        results.push(createLayerSearchResult(natureSublayers.slice(0, 9)));
    } else if (text === 'N1' || text === 'n1') {
        results.push(
            createLayerSearchResult([
                natureSublayers[0],
                ...natureSublayers.slice(9)
            ])
        );
    } else if (text === 'N01' || text === 'n01') {
        results.push(createLayerSearchResult(natureSublayers[0]));
    } else if (
        text === 'N2' ||
        text === 'N02' ||
        text === 'n2' ||
        text === 'n02'
    ) {
        results.push(createLayerSearchResult(natureSublayers[1]));
    } else if (
        text === 'N3' ||
        text === 'N03' ||
        text === 'n3' ||
        text === 'n03'
    ) {
        results.push(createLayerSearchResult(natureSublayers[2]));
    } else if (
        text === 'N4' ||
        text === 'N04' ||
        text === 'n4' ||
        text === 'n04'
    ) {
        results.push(createLayerSearchResult(natureSublayers[3]));
    } else if (
        text === 'N5' ||
        text === 'N05' ||
        text === 'n5' ||
        text === 'n05'
    ) {
        results.push(createLayerSearchResult(natureSublayers[4]));
    } else if (
        text === 'N6' ||
        text === 'N06' ||
        text === 'n6' ||
        text === 'n06'
    ) {
        results.push(createLayerSearchResult(natureSublayers[5]));
    } else if (
        text === 'N7' ||
        text === 'N07' ||
        text === 'n7' ||
        text === 'n07'
    ) {
        results.push(createLayerSearchResult(natureSublayers[6]));
    } else if (
        text === 'N8' ||
        text === 'N08' ||
        text === 'n8' ||
        text === 'n08'
    ) {
        results.push(createLayerSearchResult(natureSublayers[7]));
    } else if (
        text === 'N9' ||
        text === 'N09' ||
        text === 'n9' ||
        text === 'n09'
    ) {
        results.push(createLayerSearchResult(natureSublayers[8]));
    } else if (text === 'N10' || text === 'n10') {
        results.push(createLayerSearchResult(natureSublayers[9]));
    } else if (text === 'N11' || text === 'n11') {
        results.push(createLayerSearchResult(natureSublayers[10]));
    } else if (text === 'N12' || text === 'n12') {
        results.push(createLayerSearchResult(natureSublayers[11]));
    } else if (text === 'N13' || text === 'n13') {
        results.push(createLayerSearchResult(natureSublayers[12]));
    } else if (text === 'N14' || text === 'n14') {
        results.push(createLayerSearchResult(natureSublayers[13]));
    } else if (text === 'N15' || text === 'n15') {
        results.push(createLayerSearchResult(natureSublayers[14]));
    } else if (text === 'N16' || text === 'n16') {
        results.push(createLayerSearchResult(natureSublayers[15]));
    } else if (/^n17|nt1$/i.test(text)) {
        results.push(createLayerSearchResult(natureSublayers[16]));
    } else if (/^n18|nt2$/i.test(text)) {
        results.push(createLayerSearchResult(natureSublayers[17]));
    } else if (/^nt$/i.test(text)) {
        results.push(createLayerSearchResult(natureSublayers.slice(-2)));
    }

    dispatch(
        addSearchResults(
            { data: results, provider: 'layers', reqId: requestId },
            true
        )
    );
}

/** ************************************************************************ **/

export const SearchProviders = {
    coordinates: {
        labelmsgid: "search.coordinates",
        onSearch: coordinatesSearch
    },
    geoadmin: {
        label: "Swisstopo",
        onSearch: geoAdminLocationSearch,
        requiresLayer: "a" // Make provider availability depend on the presence of a theme WMS layer
    },
    uster: {
        label: "Uster",
        onSearch: usterSearch,
        getResultGeometry: usterResultGeometry
    },
    wolfsburg: {
        label: "Wolfsburg",
        onSearch: wolfsburgSearch,
        getResultGeometry: wolfsburgResultGeometry
    },
    glarus: {
        label: "Glarus",
        onSearch: glarusSearch,
        getResultGeometry: glarusResultGeometry,
        getMoreResults: glarusMoreResults
    },
    nominatim: {
        label: "OpenStreetMap",
        onSearch: nominatimSearch
    },
    layers: {
        label: "Layers",
        onSearch: layerSearch
    }
};

export function searchProviderFactory(cfg) {
    // Note: cfg corresponds to an entry of the theme searchProviders array in themesConfig.json, in this case
    //   { key: <providerKey>, label: <label>, param: <param>, ...}
    // The entry must have at least a `key`.
    return {
        label: cfg.label,
        onSearch: (text, requestId, searchOptions, dispatch) => parametrizedSearch(cfg, text, requestId, searchOptions, dispatch),
        requiresLayer: cfg.layerName
    };
}
