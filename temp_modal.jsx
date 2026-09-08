      <Modal isOpen={isUnrecognizedModalOpen} onClose={() => setIsUnrecognizedModalOpen(false)} title="Unrecognized Scans Log">
          <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  These barcodes were scanned but could not be found in the system's stock inventory.
              </p>
              {unrecognizedScans.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                      No unrecognized scans found.
                  </div>
              ) : (
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      {unrecognizedScans.map(scan => (
                          <li key={scan.id} className="p-4 flex items-center justify-between bg-white dark:bg-zinc-800">
                              <div>
                                  <p className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{scan.barcode}</p>
                                  <p className="text-xs text-zinc-500 mt-1">
                                      Scanned: {new Date(scan.scanned_at).toLocaleString()}
                                  </p>
                              </div>
                              <button 
                                  onClick={() => deleteUnrecognizedScan(scan.id)}
                                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                  title="Dismiss notification"
                              >
                                  <TrashIcon className="w-5 h-5" />
                              </button>
                          </li>
                      ))}
                  </ul>
              )}
          </div>
      </Modal>
