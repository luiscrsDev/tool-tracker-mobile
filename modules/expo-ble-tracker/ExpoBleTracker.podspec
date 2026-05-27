require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoBleTracker'
  s.version        = package['version']
  s.summary        = 'BLE tracker module for Expo'
  s.description    = 'iBeacon and BLE tracking module for tool-tracker-mobile'
  s.license        = { :type => 'MIT' }
  s.author         = 'luiscrsdev'
  s.homepage       = 'https://github.com/luiscrsdev/tool-tracker-mobile'
  s.platform       = :ios, '13.0'
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{swift,h,m}'
end
