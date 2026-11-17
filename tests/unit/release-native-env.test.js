const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FASTFILE = path.resolve(__dirname, '../../ios/fastlane/Fastfile');
const READ_DOT_ENV = path.resolve(__dirname, '../../node_modules/react-native-config/ios/ReactNativeConfig/ReadDotEnv.rb');
const BUILD_DOTENV = path.resolve(__dirname, '../../node_modules/react-native-config/ios/ReactNativeConfig/BuildDotenvConfig.rb');
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCHEMES = [
  path.resolve(REPO_ROOT, 'ios/BlueWallet.xcodeproj/xcshareddata/xcschemes/BlueWallet.xcscheme'),
  path.resolve(REPO_ROOT, 'ios/BlueWallet.xcodeproj/xcshareddata/xcschemes/BlueWallet-dev.xcscheme'),
  path.resolve(REPO_ROOT, 'ios/BlueWallet.xcodeproj/xcshareddata/xcschemes/BlueWallet-loc.xcscheme'),
];

function runNativeEnvRegression() {
  const ruby = String.raw`
require 'fileutils'
require 'open3'
require 'tmpdir'
require 'rexml/document'
require 'rexml/xpath'

fastfile, read_dot_env, build_dotenv, repo_root, *scheme_paths = ARGV
root = Dir.mktmpdir('release-native-env-')
begin
  ENV['TMPDIR'] = root
  FileUtils.mkdir_p(File.join(root, 'ios', 'fastlane'))
  File.write(File.join(root, '.env.prd'), "APP_NAME=isolated\n")
  sentinel = File.join(root, 'sentinel.env')
  File.write(sentinel, 'sentinel-content')
  symlink = File.join(root, 'legacy-pointer')
  File.symlink(sentinel, symlink)

  section = File.read(fastfile)
  first = section.index('require "fileutils"')
  last = section.index("\n# Run")
  raise 'Fastlane helper section not found' unless first && last
  helper = File.join(root, 'ios', 'fastlane', 'Fastfile.rb')
  section = section[first...last]
  File.write(helper, "def default_platform(*); end\nmodule UI; def self.user_error!(message); raise message; end; def self.error(message); warn message; end; end\n" + section)

  ENV['BREEZ_API_KEY'] = 'dummy-breez-key-for-isolated-regression'
  ENV['ENVFILE'] = sentinel
  load helper
  first_overlay = nil
  second_overlay = nil
  with_breez_overlay do
    first_overlay = ENV.fetch('ENVFILE')
    raise 'overlay was not private to the temp directory' unless first_overlay.start_with?(root)
    raise 'overlay directory was not 0700' unless (File.lstat(File.dirname(first_overlay)).mode & 0o777) == 0o700
    raise 'overlay file was not 0600' unless (File.lstat(first_overlay).mode & 0o777) == 0o600
    with_breez_overlay do
      second_overlay = ENV.fetch('ENVFILE')
      raise 'nested overlays were not unique' if first_overlay == second_overlay
    end
    raise 'outer ENVFILE was not restored after nested call' unless ENV['ENVFILE'] == first_overlay
  end
  raise 'caller ENVFILE was not restored' unless ENV['ENVFILE'] == sentinel
  raise 'overlay survived cleanup' if File.exist?(first_overlay) || File.exist?(second_overlay)
  raise 'external sentinel changed' unless File.read(sentinel) == 'sentinel-content'
  raise 'external symlink changed' unless File.symlink?(symlink) && File.read(symlink) == 'sentinel-content'
  ENV.delete('ENVFILE')
  with_breez_overlay { raise 'nil ENVFILE was not set' unless ENV['ENVFILE'] }
  raise 'original nil ENVFILE was not restored' if ENV.key?('ENVFILE')
  ENV['ENVFILE'] = sentinel

  failed_overlay = nil
  begin
    with_breez_overlay do
      failed_overlay = ENV.fetch('ENVFILE')
      raise 'expected build failure'
    end
  rescue RuntimeError => error
    raise 'wrong exception escaped overlay' unless error.message == 'expected build failure'
  end
  raise 'ENVFILE was not restored after exception' unless ENV['ENVFILE'] == sentinel
  raise 'failed overlay survived exception cleanup' if failed_overlay && File.exist?(failed_overlay)

  read_copy = File.join(root, 'ReadDotEnv.rb')
  read_source = File.read(read_dot_env).gsub('/tmp/envfile', File.join(root, 'global-pointer'))
  File.write(read_copy, read_source)
  explicit = File.join(root, '.env.explicit')
  global = File.join(root, '.env.global')
  File.write(explicit, "SOURCE=explicit\n")
  File.write(global, "SOURCE=global\n")
  File.write(File.join(root, 'global-pointer'), "#{global}\n")
  ENV['ENVFILE'] = explicit
  load read_copy
  values, custom = read_dot_env(root)
  raise 'explicit ENVFILE did not take precedence' unless custom && values['SOURCE'] == 'explicit'

  build_copy = File.join(root, 'BuildDotenvConfig.rb')
  build_source = File.read(build_dotenv).gsub('/tmp/envfile', File.join(root, 'global-pointer'))
  File.write(build_copy, build_source)
  child_env = { 'PATH' => ENV.fetch('PATH', '/usr/bin:/bin'), 'TMPDIR' => root }

  scheme_paths.each do |scheme_path|
    scheme_name = File.basename(scheme_path).sub('BlueWallet', '').sub('.xcscheme', '').sub(/^-/, '')
    scheme_name = 'prd' if scheme_name.empty?
    fixture = Dir.mktmpdir("scheme-#{scheme_name}-", root)
    begin
      fixture_ios = File.join(fixture, 'ios')
      fixture_node = File.join(fixture, 'node_modules', 'react-native-config', 'ios', 'ReactNativeConfig')
      fixture_build = File.join(fixture, 'build')
      fixture_generated = File.join(fixture, 'generated')
      FileUtils.mkdir_p([fixture_ios, fixture_node, fixture_build, fixture_generated])
      fixture_pointer = File.join(fixture, 'global-pointer')
      fixture_read = File.read(read_dot_env).gsub('/tmp/envfile', fixture_pointer)
      File.write(File.join(fixture_node, 'ReadDotEnv.rb'), fixture_read)
      File.write(File.join(fixture_node, 'BuildXCConfig.rb'), File.read(File.join(File.dirname(build_dotenv), 'BuildXCConfig.rb')).gsub('/tmp/envfile', fixture_pointer))
      File.write(File.join(fixture_node, 'BuildDotenvConfig.rb'), File.read(build_dotenv).gsub('/tmp/envfile', fixture_pointer))
      File.chmod(0o755, File.join(fixture_node, 'BuildXCConfig.rb'), File.join(fixture_node, 'BuildDotenvConfig.rb'))
      fixture_env = File.join(fixture, ".env.#{scheme_name}")
      File.write(fixture_env, "SCHEME_NAME=#{scheme_name}\n")
      File.write(File.join(fixture_build, 'Info.plist'), 'placeholder')
      xml = REXML::Document.new(File.read(scheme_path))
      pre_actions = REXML::XPath.match(xml, '//PreActions/ExecutionAction/ActionContent')
      post_actions = REXML::XPath.match(xml, '//PostActions/ExecutionAction/ActionContent')
      raise "#{scheme_name} scheme action cardinality changed" unless pre_actions.length == 2 && post_actions.length == 1
      pre_guard = pre_actions[0].attributes['scriptText'].gsub('/tmp/envfile', fixture_pointer)
      pre_build = pre_actions[1].attributes['scriptText']
      post_cleanup = post_actions.empty? ? nil : post_actions[0].attributes['scriptText'].gsub('/tmp/envfile', fixture_pointer)
      child = { 'PATH' => ENV.fetch('PATH', '/usr/bin:/bin'), 'TMPDIR' => fixture, 'SRCROOT' => fixture_ios, 'CONFIGURATION_BUILD_DIR' => fixture_build, 'BUILD_DIR' => fixture_build, 'INFOPLIST_PATH' => 'Info.plist' }
      fallback_env = child.merge('ENVFILE' => nil)
      _, stderr, status = Open3.capture3(fallback_env, '/bin/bash', '-euo', 'pipefail', '-c', pre_guard, unsetenv_others: true)
      raise "#{scheme_name} pre-action fallback failed: #{stderr}" unless status.success?
      raise "#{scheme_name} fallback pointer missing" unless File.read(fixture_pointer).strip == ".env.#{scheme_name}"
      _, stderr, status = Open3.capture3(fallback_env, '/bin/bash', '-euo', 'pipefail', '-c', pre_build, unsetenv_others: true)
      raise "#{scheme_name} BuildXCConfig action failed: #{stderr}" unless status.success?
      fallback_xcconfig = File.join(fixture_ios, 'tmp.xcconfig')
      raise "#{scheme_name} BuildXCConfig selected wrong env" unless File.read(fallback_xcconfig).include?("SCHEME_NAME=#{scheme_name}")
      _, stderr, status = Open3.capture3(fallback_env, 'ruby', File.join(fixture_node, 'BuildDotenvConfig.rb'), fixture, fixture_generated, unsetenv_others: true)
      raise "#{scheme_name} BuildDotenvConfig fallback failed: #{stderr}" unless status.success?
      raise "#{scheme_name} native phase selected wrong env" unless File.read(File.join(fixture_generated, 'GeneratedDotEnv.m')).include?(scheme_name)
      unless post_cleanup.nil?
        _, stderr, status = Open3.capture3(fallback_env, '/bin/bash', '-euo', 'pipefail', '-c', post_cleanup, unsetenv_others: true)
        raise "#{scheme_name} post-action fallback failed: #{stderr}" unless status.success?
        raise "#{scheme_name} fallback pointer was not cleaned" if File.exist?(fixture_pointer)
      end

      sentinel_target = File.join(fixture, 'sentinel')
      File.write(sentinel_target, 'untouched')
      File.symlink(sentinel_target, fixture_pointer)
      File.write(File.join(fixture_build, 'Info.plist'), 'placeholder')
      overlay = File.join(fixture, '.env.overlay')
      File.write(overlay, "SCHEME_NAME=overlay\n")
      explicit_env = child.merge('ENVFILE' => overlay)
      _, stderr, status = Open3.capture3(explicit_env, '/bin/bash', '-euo', 'pipefail', '-c', pre_guard, unsetenv_others: true)
      raise "#{scheme_name} explicit pre-action failed: #{stderr}" unless status.success?
      raise "#{scheme_name} explicit pre-action touched global pointer" unless File.symlink?(fixture_pointer) && File.read(fixture_pointer) == 'untouched'
      _, stderr, status = Open3.capture3(explicit_env, '/bin/bash', '-euo', 'pipefail', '-c', pre_build, unsetenv_others: true)
      raise "#{scheme_name} explicit BuildXCConfig failed: #{stderr}" unless status.success?
      raise "#{scheme_name} explicit BuildXCConfig ignored overlay" unless File.read(fallback_xcconfig).include?('SCHEME_NAME=overlay')
      _, stderr, status = Open3.capture3(explicit_env, 'ruby', File.join(fixture_node, 'BuildDotenvConfig.rb'), fixture, fixture_generated, unsetenv_others: true)
      raise "#{scheme_name} explicit BuildDotenvConfig failed: #{stderr}" unless status.success?
      raise "#{scheme_name} explicit native phase ignored overlay" unless File.read(File.join(fixture_generated, 'GeneratedDotEnv.m')).include?('overlay')
      unless post_cleanup.nil?
        _, stderr, status = Open3.capture3(explicit_env, '/bin/bash', '-euo', 'pipefail', '-c', post_cleanup, unsetenv_others: true)
        raise "#{scheme_name} explicit post-action failed: #{stderr}" unless status.success?
        raise "#{scheme_name} explicit cleanup touched global pointer" unless File.symlink?(fixture_pointer) && File.read(fixture_pointer) == 'untouched'
      end

      guard_needle = 'if [ -z "' + '$' + '{ENVFILE:-}" ]; then'
      raise "#{scheme_name} guard needle cardinality changed" unless pre_guard.scan(guard_needle).length == 1
      mutant = pre_guard.sub(guard_needle, 'if true; then')
      raise "#{scheme_name} guard mutation did not apply: #{pre_guard.inspect}" if mutant == pre_guard
      File.write(File.join(fixture_build, 'Info.plist'), 'placeholder')
      _, mutant_stderr, mutant_status = Open3.capture3(explicit_env, '/bin/bash', '-euo', 'pipefail', '-c', mutant, unsetenv_others: true)
      raise "#{scheme_name} guard removal mutant failed: #{mutant_stderr}" unless mutant_status.success?
      raise "#{scheme_name} explicit guard mutation was not unsafe" unless File.read(sentinel_target) != 'untouched'
      File.delete(fixture_pointer)
      File.write(sentinel_target, 'untouched')
      File.symlink(sentinel_target, fixture_pointer)
      File.write(File.join(fixture_build, 'Info.plist'), 'placeholder')
      operator_mutant = pre_guard.sub(guard_needle, 'if [ -n "' + '$' + '{ENVFILE:-}" ]; then')
      raise "#{scheme_name} operator mutation did not apply" if operator_mutant == pre_guard
      _, operator_stderr, operator_status = Open3.capture3(explicit_env, '/bin/bash', '-euo', 'pipefail', '-c', operator_mutant, unsetenv_others: true)
      raise "#{scheme_name} operator mutant failed: #{operator_stderr}" unless operator_status.success?
      raise "#{scheme_name} -z to -n mutation was not unsafe" unless File.read(sentinel_target) != 'untouched'
    ensure
      FileUtils.remove_entry(fixture) if fixture && File.exist?(fixture)
    end
  end

  build_dir = File.join(root, 'build')
  output_dir = File.join(root, 'generated')
  FileUtils.mkdir_p([build_dir, output_dir])
  File.write(explicit, "APP_NAME=isolated\nBREEZ_API_KEY=dummy-breez-key-for-isolated-regression\n")
  stdout, stderr, status = Open3.capture3(child_env.merge('BUILD_DIR' => build_dir, 'ENVFILE' => explicit), 'ruby', build_copy, root, output_dir, unsetenv_others: true)
  raise "BuildDotenvConfig failed: #{stderr}" unless status.success?
  raise 'dummy key value leaked to build output' if [stdout, stderr].any? { |output| output.include?('dummy-breez-key-for-isolated-regression') }
  generated = File.read(File.join(output_dir, 'GeneratedDotEnv.m'))
  raise 'generated config omitted intended key' unless generated.include?('BREEZ_API_KEY') && generated.include?('dummy-breez-key-for-isolated-regression')
  puts 'PASS owned cleanup, ENV restoration, explicit precedence, and non-leaking generated output'
ensure
  FileUtils.remove_entry(root) if root && File.exist?(root)
end
`;
  execFileSync('ruby', ['-e', ruby, FASTFILE, READ_DOT_ENV, BUILD_DOTENV, REPO_ROOT, ...SCHEMES], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin', TMPDIR: os.tmpdir() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('release native environment integrity', () => {
  it('keeps release env state private, restorable, and non-leaking', () => {
    expect(runNativeEnvRegression).not.toThrow();
  });
});
