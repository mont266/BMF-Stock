import React from 'react';
import { createPortal } from 'react-dom';

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 bg-black/60 z-[10000] flex justify-center items-center p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center flex-shrink-0 sticky top-0 bg-white dark:bg-zinc-800 rounded-t-lg">
          <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default Modal;