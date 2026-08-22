/**
 * Second, self-contained build for the Sculptr Studio demo that plays inside
 * the AriTube window on the desktop.
 *
 * Kept apart from the site's own config on purpose: it emits straight into
 * public/os/studio (so it must run AFTER the main build, whose CleanWebpackPlugin
 * wipes public/) and shares nothing with the 3D site's entry, so a change here
 * cannot affect the portfolio bundle.
 */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCSSExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
    mode: 'production',
    entry: path.resolve(__dirname, '../studio-src/index.tsx'),
    output: {
        hashFunction: 'xxhash64',
        filename: 'studio.[contenthash].js',
        path: path.resolve(__dirname, '../public/os/studio'),
        publicPath: '',
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, '../studio-src/index.html'),
            filename: 'index.html',
            minify: true,
        }),
        new MiniCSSExtractPlugin({ filename: 'studio.[contenthash].css' }),
    ],
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, '../studio-src/tsconfig.json'),
                    },
                },
            },
            {
                test: /\.css$/,
                use: [MiniCSSExtractPlugin.loader, 'css-loader'],
            },
        ],
    },
    performance: { hints: false },
};
