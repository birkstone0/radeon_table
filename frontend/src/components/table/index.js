// Table component for displaying accounts, operations, and other data with sorting, filtering, and pagination
import React, { useState, useMemo, useCallback } from 'react';
import { cn } from '../../styles/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';
import { Spinner } from '../loaders';

function Table({ data, columns, onRowClick, className, emptyMessage = 'No data found.' }) {
    const [sortColumn, setSortColumn] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc');
    const [searchTerm, setSearchTerm] = useState('');

    const filteredData = useMemo(() => {
        if (!searchTerm) return data;
        const searchLower = searchTerm.toLowerCase();
        return data.filter((row) =>
            columns.some((col) => {
                const value = row[col.accessor];
                return value && String(value).toLowerCase().includes(searchLower);
            })
        );
    }, [data, searchTerm, columns]);

    const sortedData = useMemo(() => {
        if (!sortColumn) return filteredData;
        return [...filteredData].sort((a, b) => {
            const aValue = a[sortColumn];
            const bValue = b[sortColumn];
            if (aValue === bValue) return 0;
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            }
            return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        });
    }, [filteredData, sortColumn, sortDirection]);

    const toggleSort = useCallback(
        (column) => {
            if (sortColumn === column) {
                setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
            } else {
                setSortColumn(column);
                setSortDirection('asc');
            }
        },
        [sortColumn]
    );

    const getSortIcon = useCallback(
        (column) => {
            if (sortColumn === column) {
                return sortDirection === 'asc' ? <ChevronUp className='w-4 h-4' /> : <ChevronDown className='w-4 h-4' />;
            }
            return <ChevronsUpDown className='w-4 h-4 text-gray-500' />;
        },
        [sortColumn, sortDirection]
    );

    return (
        <div className={cn('rounded-lg border border-green-800/50 bg-green-950/40 overflow-hidden', className)}>
            <div className='p-4 border-b border-green-800/30'>
                <div className='relative max-w-sm'>
                    <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400' />
                    <input
                        type='text'
                        placeholder='Search...'
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className='w-full pl-10 pr-4 py-2 bg-green-950/60 border border-green-800/50 rounded-md text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500'
                    />
                </div>
            </div>

            <div className='overflow-x-auto'>
                <table className='w-full text-sm text-left text-gray-300'>
                    <thead className='text-xs text-gray-400 uppercase bg-green-950/60 border-b border-green-800/30'>
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col.accessor}
                                    className={cn(
                                        'px-6 py-3 cursor-pointer hover:bg-green-900/20 transition-colors',
                                        col.sortable !== false && 'select-none'
                                    )}
                                    onClick={() => col.sortable !== false && toggleSort(col.accessor)}
                                >
                                    <div className='flex items-center gap-2'>
                                        {col.header}
                                        {col.sortable !== false && getSortIcon(col.accessor)}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-green-900/30'>
                        {sortedData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className='px-6 py-12 text-center text-gray-500'>
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            sortedData.map((row, i) => (
                                <tr
                                    key={i}
                                    className={cn(
                                        'hover:bg-green-900/20 cursor-pointer transition-colors',
                                        onRowClick && 'hover:bg-green-900/20'
                                    )}
                                    onClick={() => onRowClick && onRowClick(row)}
                                >
                                    {columns.map((col) => (
                                        <td key={col.accessor} className='px-6 py-4 whitespace-nowrap'>
                                            {col.cell ? col.cell(row) : row[col.accessor]}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export { Table };
