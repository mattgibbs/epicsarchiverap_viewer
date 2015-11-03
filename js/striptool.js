require.config ({
    baseUrl: 'js' ,

    waitSeconds : 15,
    urlArgs     : "bust="+new Date().getTime() ,

    paths: {
        'jquery'            : 'jquery/js/jquery-1.8.2' ,
        'jquery-ui'         : 'jquery/js/jquery-ui-1.9.1.custom.min' ,
        'jquery.resize'     : 'jquery/js/jquery.resize' ,
        'jquery.mousewheel' : 'jquery/js/jquery.mousewheel' ,
        'underscore'        : 'underscore/underscore-min'
    } ,
    shim : {
        'jquery' : {
            exports : '$'
        } ,
        'jquery-ui' : {
            exports : '$' ,
            deps : ['jquery']
        } ,
        'jquery.resize' :  {
            deps : ['jquery']
        } ,
        'jquery.mousewheel' :  {
            deps : ['jquery']
        } ,
        'underscore' : {
            exports  : '_'
        }
    }
}) ;

require ([
    'CSSLoader' ,
    'Class' ,
    'TimeSeriesPlotN' ,
    'Definitions' ,
    'Interval' ,
    'WebService' ,
    'Finder' ,
    'Display' ,
    'DisplaySelector' ,
    'DataTableDisplay' ,

    // Make sure the core libraries are preloaded so that the applications
    // won't borther with loading them individually

    'jquery', 'jquery-ui', 'jquery.resize', 'jquery.mousewheel', 'underscore'] ,

  function (
    cssloader ,
    Class ,
    TimeSeriesPlotN ,
    Definitions ,
    Interval ,
    WebService ,
    Finder ,
    Display ,
    DisplaySelector, 
    DataTableDisplay) {
      
      /* All that crap above is horrible dependency loading stuff.  Everything below is the actual application logic. */
      cssloader.load('js/jquery/css/custom-theme-1.9.1/jquery-ui.custom.css');
      function EpicsViewer (pvs) {
        var _that = this ;
        this._options = {
            pvs: pvs ? pvs : []
        } ;
        this._pvfinder = null ;         // UI for searching PVs to be included into the work set
        this._selected = null ;         // the current workset table
        this._interval = null ;         // the current timeine interval management
        // displays (plots)
        this._displaySelector = null ;
        // total number of PVs to be loaded
        this._num2load = 0 ;
        // range locking for PVs
        this._y_range_lock = {} ;
        // rendering is done only once
        this._is_rendered = false ;
        this.run = function () {
          if (this._is_rendered) return;
          this._is_rendered = true;
          //Make a Finder, which is how you select PVs.
          this._pvfinder = new Finder ($('#finder'), {
              on_select: function (pvname) {
                  if (_.indexOf(_that._options.pvs, pvname) === -1) {
                      _that._options.pvs.push(pvname) ;
                      _that._num2load++ ;
                      _that.load_pvtypeinfo(pvname) ;
                  }
              }
          }) ;
          this._selected = $('#getdata_control > #selected > table') ;
          this._selected.children('thead').children('tr:first-child').click(function () {
              var tbody = _that._selected.children('tbody') ;
              if (tbody.hasClass   ('selected-tbody-visible')) {
                  tbody.removeClass('selected-tbody-visible').addClass('selected-tbody-hidden') ;
              } else {
                  tbody.removeClass('selected-tbody-hidden') .addClass('selected-tbody-visible') ;
              }
              // Need to tell the displays that there is an unexpected change in the layout
              // of the window.
              _that.ds.resize() ;
          }) ;
          
          //Make an Interval item, which is sort of like the X axis for our plot.
          this._interval = new Interval.Interval ({
              changes_allowed: function () {
                return true;
              },
              on_change: function (xbins) {
                  //Just wait for the next data update.
              }
          });
          //Make a DisplaySelector, which is pretty useless because we only have one item.
          this.ds = new DisplaySelector ($('#display'), [
            {  id:     'StripTool' ,
               title:  'T<sub>series</sub>' ,
               descr:  'Plots PV values vs. Time.' ,
               widget: new TimeSeriesPlotN({
                x_zoom_in:      function (e) { _that._interval.zoomIn   (e.xbins) ; } ,
                x_zoom_out:     function (e) { _that._interval.zoomOut  (e.xbins) ; } ,
                x_move_left:    function (e) { _that._interval.moveLeft (e.xbins, e.dx) ; } ,
                x_move_right:   function (e) { _that._interval.moveRight(e.xbins, e.dx) ; } ,
                y_range_change: function (name, yRange) {
                    if (yRange) {
                        _that._y_range_lock[name] = {
                            min: yRange.min ,
                            max: yRange.max
                        } ;
                    } else {
                        if (_that._y_range_lock[name]) {
                            delete _that._y_range_lock[name] ;
                        }
                    }
                } ,
                y_toggle_scale: function (name) {
                    switch (_that._scales[name]) {
                        case 'linear': _that._scales[name] = 'log10' ;  break ;
                        case 'log10' : _that._scales[name] = 'linear' ; break ;
                    }
                    _that._selectedPVs[name].find('select[name="scale"]').val(_that._scales[name]) ;
                    //_that._loadAllTimeLines() ;
                } ,
                ruler_change: function (values) {
                    for (var pvname in values) {
                        var v = values[pvname] ;
                        if (_.isUndefined(v)) continue ;
                        var msec = Math.floor(1000. * v[0]) ,
                            t = new Date(msec) ;
                        _that._selectedPVs[pvname].children('td.time') .html(Interval.time2htmlLocal(t)) ;
                        _that._selectedPVs[pvname].children('td.value').text(v[1]) ;
                    }
                } ,
                download_requested: function (dataURL) {
                    // Change MIME type to trick the browser to download
                    // the file instead of displaying it.
                    // dataURL = dataURL.replace(/^data:image\/[^;]*/, 'data:application/octet-stream');
                    // In addition to <a>'s "download" attribute, you can
                    // define HTTP-style headers.
                    // dataURL = dataURL.replace(/^data:application\/octet-stream/, 'data:application/octet-stream;headers=Content-Disposition%3A%20attachment%3B%20filename=Canvas.png');

                    window.open(dataURL, '_blank') ;
                } ,
                download_allowed: function () {
                    return false
                }
              }) //End of plot instantiation.
            }
          ]); // End of DisplaySelector instantiation.
          
          this.pvtypeinfo = {};
          //Get the PV type from the archiver.
          this.load_pvtypeinfo = function (pvname) {
              WebService.GET (
                  window.global_options.retrieval_url_base + "/bpl/getMetadata" ,
                  {pv: pvname} ,
                  function (data) {
                      // filtering on the scalar data types (except strings) s per:
                      // http://epicsarchiverap.sourceforge.net/api/org/epics/archiverappliance/config/ArchDBRTypes.html
                      switch (data.DBRType) {
                          case 'DBR_SCALAR_ENUM':
                          case 'DBR_SCALAR_BYTE':
                          case 'DBR_SCALAR_SHORT':
                          case 'DBR_SCALAR_INT':
                          case 'DBR_SCALAR_FLOAT':
                          case 'DBR_SCALAR_DOUBLE':
                              break ;
                          default:
                              if (_.indexOf(_that._options.pvs, pvname) !== -1) {
                                  delete _that._options.pvs[pvname];
                              }
                              return ;
                      }
                      _that.pvtypeinfo[pvname] = data;
                      _that._addEntryToSelected(pvname);
                      //_that.load_timeline(pvname);
                  }
              );
          };
          //Initialize a bunch of state variables.
          var _DEFAULT_PLOT_COLOR = ['#0071bc', '#983352', '#277650', '#333676', '#AA5939'] ;
          this._colorCounter = 0 ;
          this._getNextColor = function () {
              return _DEFAULT_PLOT_COLOR[this._colorCounter++ % _DEFAULT_PLOT_COLOR.length] ;
          };
          this._plot = {};
          this._colors = {};
          this._processing = {};
          this._scales = {};
          this._selectedPVs = {};
          this._addEntryToSelected = function (pvname) {
              this._plot[pvname] = true ;
              this._colors[pvname] = this._getNextColor() ;
              this._processing[pvname] = '' ;
              this._scales[pvname] = 'linear' ;
              var html =
                '<tr id="'+pvname+'" > ' +
                  '<td><button name="delete" class="control-button-important" >x</button></td> ' +
                  '<td><input  name="plot"   type="checkbox" checked="checked" /></td> ' +
                  '<td class="pvname" >' +
                    '<div style="float:left; width: 12px; height:12px; background-color: '+this._colors[pvname]+';" >&nbsp;</div> ' +
                    '<div style="float:left; margin-left:4px;" >' + pvname + '</div> ' +
                    '<div style="clear:both;" ></div> ' +
                  '</td> ' +
                  '<td>'+this.pvtypeinfo[pvname].DBRType+'</td> ' +
                  '<td>'+this.pvtypeinfo[pvname].units+'</td> ' +
                  '<td> ' +
                    '<select name="scale" > ' +
                      '<option val="linear" >linear</option> ' +
                      '<option val="log10"  >log10</option> ' +
                    '</select> ' +
                  '</td> ' +
                  '<td class="time" ></td> ' +
                  '<td class="value" ></td> ' +
                  '<td class="notes" ></td> ' +
                '</tr> ' ;
              this._selected.children('tbody').append(html) ;
              this._selectedPVs[pvname] = this._selected.children('tbody').find('tr[id="'+pvname+'"]') ;
              this._selectedPVs[pvname].children('td.pvname')
                  .mouseover(function () {
                      var tr = $(this).closest('tr') ;
                      var pvname = tr.prop('id') ;
                      _that.ds.get('StripTool').highlight(pvname, true) ;
                  })
                  .mouseout(function () {
                      var tr = $(this).closest('tr') ;
                      var pvname = tr.prop('id') ;
                      _that.ds.get('StripTool').highlight(pvname, false) ;
                  });
              /*
              this._selectedPVs[pvname].find('button[name="delete"]').button().click(function () {
                  var tr = $(this).closest('tr') ;
                  var pvname = tr.prop('id') ;
                  _that._removeEntryFromSelected(pvname) ;
              }) ;
              */
              /*
              this._selectedPVs[pvname].find('input[name="plot"]').change(function () {
                  var tr = $(this).closest('tr') ;
                  var pvname = tr.prop('id') ;
                  _that._plot[pvname] = $(this).prop('checked') ? true : false ;
                  //_that.display_timeline() ;
              }) ;
              */
              /*
              this._selectedPVs[pvname].find('select[name="processing"]').change(function () {
                  var tr = $(this).closest('tr') ;
                  var pvname = tr.prop('id') ;
                  _that._processing[pvname] = $(this).val() ;
                  //_that._loadAllTimeLines() ;
              }) ;*/
              /*
              this._selectedPVs[pvname].find('select[name="scale"]').change(function () {
                  var tr = $(this).closest('tr') ;
                  var pvname = tr.prop('id') ;
                  _that._scales[pvname] = $(this).val() ;
                  //delete _that._y_range_lock[pvname] ;
                  //_that._loadAllTimeLines() ;
              }).prop('disabled', true) ;*/
          } ;
          /*
          this._removeEntryFromSelected = function (pvname) {
              delete this._plot[pvname] ;
              delete this._colors[pvname] ;
              delete this._scales[pvname] ;
              delete this._processing[pvname] ;
              this._selectedPVs[pvname].remove() ;
              delete this._selectedPVs[pvname] ;
              delete this.pvtypeinfo[pvname] ;
              delete this.pvdata[pvname] ;
              this._options.pvs = _.filter(this._options.pvs, function (pv) { return pv !== pvname ; }) ;
              //this._loadAllTimeLines() ;
          } ;
          
          this._loadAllTimeLines = function (xbins) {
              this._num2load = this._options.pvs.length ;
              if (this._num2load)
                  this._disableControls(true) ;
              for (var pvname in this.pvtypeinfo) {
                  this.load_timeline(pvname, xbins) ;
              }
          } ;*/
          
          if (this._options.pvs) {
              for (var i = 0; i < this._options.pvs.length; ++i) {
                  this._num2load++;
                  this.load_pvtypeinfo(this._options.pvs[i]) ;
              }
          }
      
          if ('WebSocket' in window) {
            this._socket = new WebSocket(window.global_options.websockets_url_base);
          } else if ('MozWebSocket' in window) {
            this._socket = new MozWebSocket(window.global_options.websockets_url_base);
          }
      
          this._buffer_size = 3000;
          this.pv_data = [];
          this.data_index_for_pv = {}
          this._options.pvs.forEach(function(pv, i) {
            //_that._plot[pv] = true ;
            //_that._colors[pv] = _that._getNextColor();
            //_that._processing[pv] = '';
            //_that._scales[pv] = 'linear';
            _that.pv_data.push({
                name: pv,
                yRange: {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY},
                yLockedRange: _that._y_range_lock[pv] ? _that._y_range_lock[pv] : undefined,
                points: [],
                color: _that._colors[pv],
                scale: _that._scales[pv]
            });
            _that.data_index_for_pv[pv] = i;
          });
      
          console.log("PV List is: " + _that._options.pvs)
      
          //When the websocket connection opens, request to get data for PVs in the list.
          this._socket.onopen = function() {
            _that._options.pvs.forEach(function(pv) {
              console.log("Connecting to " + pv);
              _that._socket.send(pv);
            });
          };
      
          //Parse incoming messages.
          this._socket.onmessage = function(event) {
            var json = JSON.parse(event.data);
            if (json.msg_type === "connection") {
              //This happens when a pv connection starts or ends.
              console.log("Connected to " + json.pvname);
              return;
            }
        
            if (json.msg_type === "monitor") {
              //This happens any time a PV updates.
              if(json.value !== undefined){
                var i = _that.data_index_for_pv[json.pvname];
                var now = new Date();
                var v = json.value;
                var t = now / 1000.;
            
                //This is probably a super-inefficient way to implement a ring buffer.
                if(_that.pv_data[i].points.length >= _that._buffer_size) {
                  _that.pv_data[i].points.shift();
                }
                _that.pv_data[i].points.push([t,v]);
                _that.pv_data[i].yLockedRange = _that._y_range_lock[json.pvname] ? _that._y_range_lock[json.pvname] : undefined
                _that.pv_data[i].yRange.min = Math.min(_that.pv_data[i].yRange.min, v);
                _that.pv_data[i].yRange.max = Math.max(_that.pv_data[i].yRange.max, v);
                _that._interval._end_time_changed(now);
                var x_range = {
                    min: _that._interval.from / 1000. ,   // msec -> secs.*
                    max: _that._interval.to   / 1000.     // msec -> secs.*
                } ;
                _that.ds.get('StripTool').load(x_range, _that.pv_data);
          	  }
              return;
            }
          };
        }
      }
      // Starting point for the application
      $(function () {
          var viewer = new EpicsViewer(["BPMS:LI24:801:X1H", "BPMS:LI24:301:X1H"]) ;
          viewer.run() ;
      }) ;
});
    
    